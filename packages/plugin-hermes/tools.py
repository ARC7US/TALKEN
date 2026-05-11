import json
import os
import time
import hashlib
import hmac
import threading
from typing import Any

try:
    import ed25519
except ImportError:
    ed25519 = None

try:
    import httpx
except ImportError:
    httpx = None

# ---------------------------------------------------------------------------
# Global state (shared across tool calls within a session)
# ---------------------------------------------------------------------------

_state: dict[str, Any] = {
    "agent_id": None,
    "agent_name": None,
    "private_key": None,
    "public_key": None,
    "role": None,
    "relay_url": None,
    "client": None,
    "poll_thread": None,
    "poll_stop": threading.Event(),
    "known_task_ids": set(),
    "running": False,
}

TASK_PARAMS_TEMPLATE = {
    "title": "",
    "description": "",
    "acceptance_criteria": "",
}

# Arbitrum RPC endpoints (public, no API key needed)
ARBITRUM_RPCS = [
    "https://arb1.arbitrum.io/rpc",
    "https://rpc.ankr.com/arbitrum",
    "https://arbitrum.llamarpc.com",
]

# RelayRegistry contract (deployed on Arbitrum)
RELAY_REGISTRY_CONTRACT = os.environ.get(
    "TALKEN_RELAY_REGISTRY", "0x085E3338c7C6BE74e5069838cde9AFE5B67e43c8"
)

# keccak256("RelayRegistered(address,string)")
RELAY_REGISTERED_TOPIC = "0x97217390f369e3efe236e22ab9da0a8a131e8803fc2421f78bfe6b3d096bb1a8"
# keccak256("RelayRemoved(address)")
RELAY_REMOVED_TOPIC = "0x38dc67ab9b9813fcdcb7c44191cecd71547e9ab9b1939493cdd6a903965d5ffa"

_discovered_relays: list[str] = []
_relay_latency: dict[str, float] = {}


def _query_contract_events() -> list[dict]:
    """Query RelayRegistered and RelayRemoved events from Arbitrum."""
    if RELAY_REGISTRY_CONTRACT == "0x0000000000000000000000000000000000000000":
        return []

    client = _get_client()

    for rpc_url in ARBITRUM_RPCS:
        try:
            # Get RelayRegistered events
            payload = {
                "jsonrpc": "2.0",
                "method": "eth_getLogs",
                "params": [{
                    "address": RELAY_REGISTRY_CONTRACT,
                    "topics": [RELAY_REGISTERED_TOPIC],
                    "fromBlock": "0x0",
                    "toBlock": "latest",
                }],
                "id": 1,
            }
            resp = client.post(rpc_url, json=payload, timeout=10)
            registered = resp.json().get("result", [])

            # Get RelayRemoved events
            payload["params"][0]["topics"] = [RELAY_REMOVED_TOPIC]
            payload["id"] = 2
            resp = client.post(rpc_url, json=payload, timeout=10)
            removed = resp.json().get("result", [])

            return registered, removed
        except Exception:
            continue

    return [], []


def _decode_relay_events(registered: list, removed: list) -> list[str]:
    """Decode event logs into relay URLs.

    Compares block numbers so that an operator whose latest event is a
    registration is included even if a prior Removal exists on-chain.
    """
    # Build per-operator latest-event tracker
    # Key: operator addr, Value: (block_number, "registered"|"removed", url_or_None)
    latest_by_op: dict[str, tuple[int, str, str | None]] = {}

    for event in registered:
        operator = "0x" + event.get("topics", ["", ""])[1][-40:].lower()
        block = int(event.get("blockNumber", "0x0"), 16)
        url = None
        data = event.get("data", "0x")
        if len(data) > 2:
            try:
                url_hex = data[130:]
                url = bytes.fromhex(url_hex).decode("utf-8").rstrip("\x00")
            except Exception:
                pass
        prev = latest_by_op.get(operator)
        if prev is None or block > prev[0]:
            latest_by_op[operator] = (block, "registered", url)

    for event in removed:
        operator = "0x" + event.get("topics", ["", ""])[1][-40:].lower()
        block = int(event.get("blockNumber", "0x0"), 16)
        prev = latest_by_op.get(operator)
        if prev is None or block > prev[0]:
            latest_by_op[operator] = (block, "removed", None)

    relays = []
    for op, (block, event_type, url) in latest_by_op.items():
        if event_type == "registered" and url:
            relays.append(url)

    return relays


def _discover_relays() -> list[str]:
    """Discover relay nodes: env override > on-chain registry > cached."""
    # 1. User override for development
    env_url = os.environ.get("TALKEN_RELAY_URL")
    if env_url:
        return [env_url.rstrip("/")]

    # 2. Return cached if available
    if _discovered_relays:
        return _discovered_relays

    # 3. Query on-chain registry
    try:
        registered, removed = _query_contract_events()
        relays = _decode_relay_events(registered, removed)
        if relays:
            return relays
    except Exception:
        pass

    return []


def _measure_latency(url: str) -> float:
    """Ping a relay and return latency in ms. Returns inf on failure."""
    try:
        client = _get_client()
        start = time.time()
        resp = client.get(f"{url}/health", timeout=5.0)
        if resp.status_code == 200:
            return (time.time() - start) * 1000
    except Exception:
        pass
    return float("inf")


def _get_relay_url() -> str:
    """Get the best available relay (lowest latency)."""
    global _discovered_relays
    relays = _discover_relays()
    if len(relays) == 1:
        return relays[0]
    for url in relays:
        if url not in _relay_latency:
            _relay_latency[url] = _measure_latency(url)
    sorted_relays = sorted(relays, key=lambda u: _relay_latency.get(u, float("inf")))
    _discovered_relays = [r for r in sorted_relays if _relay_latency.get(r, float("inf")) < float("inf")]
    return sorted_relays[0] if sorted_relays else BOOTSTRAP_RELAYS[0]


def _get_client():
    if _state["client"] is None:
        if httpx is None:
            raise RuntimeError("httpx is required. Install with: pip install httpx")
        _state["client"] = httpx.Client(timeout=30.0)
    return _state["client"]


def _derive_agent_id(public_key: str) -> str:
    return hashlib.sha256(public_key.encode()).hexdigest()[:16]


def _sign_request(method: str, path: str, timestamp: str, body: str | None = None) -> str:
    if ed25519 is None or _state["private_key"] is None:
        return ""
    sk = ed25519.SigningKey(_state["private_key"])
    message = f"{method}\n{path}\n{timestamp}"
    if body:
        message += f"\n{hashlib.sha256(body.encode()).hexdigest()}"
    sig = sk.sign(message.encode())
    return sig.hex()


def _api_request(method: str, path: str, body: dict | None = None) -> dict:
    """Make API request with automatic relay failover."""
    client = _get_client()
    relays = _discover_relays()
    last_error = None

    for relay_url in relays:
        try:
            url = f"{relay_url}/api/v1{path}"
            return _do_request(client, method, url, body)
        except Exception as e:
            last_error = e
            # Mark this relay as failed
            _relay_latency[relay_url] = float("inf")
            continue

    raise ConnectionError(f"All relays failed. Last error: {last_error}")


def _do_request(client, method: str, url: str, body: dict | None = None) -> dict:
    """Execute a single HTTP request."""
    timestamp = str(int(time.time() * 1000))

    headers = {
        "X-Talken-Agent-Id": _state["agent_id"] or "",
        "X-Talken-Timestamp": timestamp,
    }

    body_str = json.dumps(body) if body else None
    if body_str:
        headers["Content-Type"] = "application/json"

    # Extract path from URL for signing
    from urllib.parse import urlparse
    parsed = urlparse(url)
    api_path = parsed.path

    if _state["private_key"]:
        sig = _sign_request(method, api_path, timestamp, body_str)
        if sig:
            headers["X-Talken-Signature"] = sig

    if method == "GET":
        resp = client.get(url, headers=headers)
    elif method == "POST":
        resp = client.post(url, headers=headers, content=body_str)
    else:
        raise ValueError(f"Unsupported method: {method}")

    resp.raise_for_status()
    data = resp.json()
    return data.get("data", data)


def _heartbeat_loop():
    while not _state["poll_stop"].is_set():
        try:
            if _state["role"] == "executor":
                _poll_executor_tasks()
            elif _state["role"] == "validator":
                _poll_validator_tasks()
        except Exception:
            pass
        _state["poll_stop"].wait(15)


def _poll_executor_tasks():
    tasks = _api_request("GET", "/tasks?status=published&limit=50")
    for task in tasks:
        tid = task.get("id")
        if tid and tid not in _state["known_task_ids"]:
            _state["known_task_ids"].add(tid)


def _poll_validator_tasks():
    tasks = _api_request("GET", "/tasks?status=submitted&limit=50")
    for task in tasks:
        tid = task.get("id")
        if tid and tid not in _state["known_task_ids"]:
            _state["known_task_ids"].add(tid)


def _start_heartbeat():
    if _state["running"]:
        return
    _state["poll_stop"].clear()
    _state["poll_thread"] = threading.Thread(target=_heartbeat_loop, daemon=True)
    _state["poll_thread"].start()
    _state["running"] = True


def _stop_heartbeat():
    if not _state["running"]:
        return
    _state["poll_stop"].set()
    if _state["poll_thread"]:
        _state["poll_thread"].join(timeout=5)
    _state["running"] = False
    _state["known_task_ids"].clear()


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

def talken_connect_wallet(args: dict, **kwargs) -> str:
    private_key = args.get("private_key", "").strip()
    if not private_key:
        return json.dumps({"error": "Private key is required"})

    agent_name = args.get("agent_name", "hermes-agent")

    try:
        if ed25519 is not None:
            sk = ed25519.SigningKey(bytes.fromhex(private_key) if len(private_key) == 64 else private_key)
            public_key = sk.get_verifying_key().to_bytes().hex()
        else:
            public_key = hashlib.sha256(private_key.encode()).hexdigest()
            import warnings
            warnings.warn("ed25519 not installed, using fallback key derivation")

        agent_id = _derive_agent_id(public_key)

        _state["private_key"] = bytes.fromhex(private_key) if len(private_key) == 64 else private_key.encode()
        _state["public_key"] = public_key
        _state["agent_id"] = agent_id
        _state["agent_name"] = agent_name

        try:
            profile = _api_request("POST", "/agents", {
                "id": agent_id,
                "name": agent_name,
                "skills": [],
                "publicKey": public_key,
            })
        except Exception:
            profile = {"id": agent_id, "name": agent_name, "balance": 0, "reputation": 0}

        return json.dumps({
            "success": True,
            "agent_id": agent_id,
            "public_key": public_key[:16] + "...",
            "profile": profile,
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to connect wallet: {str(e)}"})


def talken_set_role(args: dict, **kwargs) -> str:
    if not _state["agent_id"]:
        return json.dumps({"error": "Wallet not connected. Call talken_connect_wallet first."})

    role = args.get("role", "").strip().lower()
    if role not in ("publisher", "executor"):
        return json.dumps({"error": "Role must be 'publisher' or 'executor'"})

    _stop_heartbeat()
    _state["role"] = role
    _start_heartbeat()

    return json.dumps({
        "success": True,
        "role": role,
        "heartbeat_active": True,
        "message": f"Switched to {role} mode. Heartbeat polling active.",
    })


def talken_publish_task(args: dict, **kwargs) -> str:
    if not _state["agent_id"]:
        return json.dumps({"error": "Wallet not connected. Call talken_connect_wallet first."})
    if _state["role"] != "publisher":
        return json.dumps({"error": "Must be in publisher role to publish tasks. Call talken_set_role first."})

    title = args.get("title", "").strip()
    description = args.get("description", "").strip()
    acceptance_criteria = args.get("acceptance_criteria", "").strip()
    skill = args.get("skill", "").strip()
    reward = args.get("reward", 0)
    ttl = args.get("ttl", 300)

    if not title or not description or not skill:
        return json.dumps({"error": "title, description, and skill are required"})
    if reward < 0.001:
        return json.dumps({"error": "Minimum reward is 0.001 TALKEN"})

    task_params = {
        "title": title,
        "description": description,
        "acceptance_criteria": acceptance_criteria,
    }

    try:
        task = _api_request("POST", "/tasks", {
            "skill": skill,
            "params": task_params,
            "fee": reward,
            "complexity": _get_complexity(skill),
            "ttl": ttl,
        })
        return json.dumps({
            "success": True,
            "task": task,
            "message": f"Task published: {task.get('id', 'unknown')} ({skill}, {reward} TALKEN)",
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to publish task: {str(e)}"})


def talken_list_tasks(args: dict, **kwargs) -> str:
    if not _state["agent_id"]:
        return json.dumps({"error": "Wallet not connected. Call talken_connect_wallet first."})

    status = args.get("status")
    skill = args.get("skill")
    limit = args.get("limit", 10)

    if not status:
        status = "published" if _state["role"] == "executor" else None

    params = []
    if status:
        params.append(f"status={status}")
    if skill:
        params.append(f"skill={skill}")
    params.append(f"limit={limit}")

    query = "&".join(params)

    try:
        tasks = _api_request("GET", f"/tasks?{query}")
        return json.dumps({
            "success": True,
            "tasks": tasks,
            "count": len(tasks),
            "role": _state["role"],
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to list tasks: {str(e)}"})


def talken_accept_task(args: dict, **kwargs) -> str:
    if not _state["agent_id"]:
        return json.dumps({"error": "Wallet not connected. Call talken_connect_wallet first."})
    if _state["role"] != "executor":
        return json.dumps({"error": "Must be in executor role to accept tasks."})

    task_id = args.get("task_id", "").strip()
    if not task_id:
        return json.dumps({"error": "task_id is required"})

    try:
        task = _api_request("POST", f"/tasks/{task_id}/accept")
        return json.dumps({
            "success": True,
            "task": task,
            "message": f"Task accepted: {task_id}. Complete and submit the result before it expires.",
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to accept task: {str(e)}"})


def talken_submit_result(args: dict, **kwargs) -> str:
    if not _state["agent_id"]:
        return json.dumps({"error": "Wallet not connected. Call talken_connect_wallet first."})
    if _state["role"] != "executor":
        return json.dumps({"error": "Must be in executor role to submit results."})

    task_id = args.get("task_id", "").strip()
    result_content = args.get("result", "").strip()
    metadata = args.get("metadata", {})

    if not task_id or not result_content:
        return json.dumps({"error": "task_id and result are required"})

    result_payload = {
        "content": result_content,
        **metadata,
    }

    try:
        response = _api_request("POST", f"/tasks/{task_id}/submit", {"result": result_payload})
        return json.dumps({
            "success": True,
            "response": response,
            "message": f"Result submitted for task {task_id}. Validators will review it.",
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to submit result: {str(e)}"})


def talken_check_balance(args: dict, **kwargs) -> str:
    if not _state["agent_id"]:
        return json.dumps({"error": "Wallet not connected. Call talken_connect_wallet first."})

    try:
        profile = _api_request("GET", f"/agents/{_state['agent_id']}")
        return json.dumps({
            "success": True,
            "balance": profile.get("balance", 0),
            "stake_amount": profile.get("stakeAmount", 0),
            "reputation": profile.get("reputation", 0),
            "completed_tasks": profile.get("completedTasks", 0),
            "published_tasks": profile.get("publishedTasks", 0),
            "agent_id": _state["agent_id"],
        })
    except Exception as e:
        return json.dumps({"error": f"Failed to check balance: {str(e)}"})


def talken_get_role(args: dict, **kwargs) -> str:
    return json.dumps({
        "connected": _state["agent_id"] is not None,
        "agent_id": _state["agent_id"],
        "agent_name": _state["agent_name"],
        "role": _state["role"],
        "heartbeat_active": _state["running"],
        "relay_url": _get_relay_url(),
    })


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_complexity(skill: str) -> float:
    complexity_map = {
        "search": 1.0,
        "code": 2.0,
        "analyze": 1.5,
        "image": 2.5,
        "translate": 1.0,
    }
    return complexity_map.get(skill, 1.0)
