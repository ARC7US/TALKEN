import json
import os
import time
import hashlib
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

RELAY_REGISTRY = os.environ.get(
    "TALKEN_RELAY_REGISTRY", "0x48e58C867842c87cE7259C2f6cda7D48D199dbee"
)
# keccak256("RelayRegistered(address,string)")
RELAY_REGISTERED_TOPIC = "0x97217390f369e3efe236e22ab9da0a8a131e8803fc2421f78bfe6b3d096bb1a8"
# keccak256("RelayRemoved(address)")
RELAY_REMOVED_TOPIC = "0x38dc67ab9b9813fcdcb7c44191cecd71547e9ab9b1939493cdd6a903965d5ffa"
ARBITRUM_RPCS = [
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum.llamarpc.com",
]

# Max blocks per eth_getLogs call (public RPCs reject larger ranges)
BATCH_BLOCK_RANGE = 5000

# Incremental relay sync state
_discovered_relays: list[str] = []
_relays_cache_time: float = 0
_operator_states: dict[str, dict] = {}  # op_addr -> {block, status, url}
_last_synced_block: int = 0

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


def _measure_latency(url: str) -> tuple[str, float]:
    """Measure HTTP latency to a relay's /health endpoint. Returns (url, latency_ms)."""
    http_url = url.replace("ws://", "http://").replace("wss://", "https://") + "/health"
    client = _get_client()
    try:
        start = time.time()
        resp = client.get(http_url, timeout=3)
        elapsed = (time.time() - start) * 1000
        if resp.status_code == 200:
            return (url, elapsed)
    except Exception:
        pass
    return (url, float("inf"))


def _get_public_ip() -> str:
    """Get this machine's public IP for region matching."""
    client = _get_client()
    for svc in ["https://api.ipify.org", "https://ifconfig.me/ip"]:
        try:
            resp = client.get(svc, timeout=3)
            return resp.text.strip()
        except Exception:
            continue
    return ""


def _ip_prefix(ip: str, bits: int = 16) -> str:
    """Extract IP prefix for regional grouping."""
    parts = ip.replace("ws://", "").replace("wss://", "").replace("http://", "").replace("https://", "")
    # Extract host from URL
    host = parts.split("/")[0].split(":")[0]
    try:
        import ipaddress
        addr = ipaddress.ip_address(host)
        if addr.version == 4:
            # Return /16 prefix
            octets = str(addr).split(".")
            return ".".join(octets[:2]) if bits == 16 else ".".join(octets[:1])
    except Exception:
        pass
    return host


def _get_current_block(client) -> int:
    """Get latest Arbitrum block number."""
    for rpc_url in ARBITRUM_RPCS:
        try:
            payload = {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1}
            resp = client.post(rpc_url, json=payload, timeout=10)
            return int(resp.json()["result"], 16)
        except Exception:
            continue
    return 0


def _query_events_batch(client, rpc_url: str, from_block: int, to_block: int):
    """Query both Registered and Removed events in one call using OR topic filter.
    Returns (registered_events, removed_events).
    """
    payload = {
        "jsonrpc": "2.0",
        "method": "eth_getLogs",
        "params": [{
            "address": RELAY_REGISTRY,
            "topics": [[RELAY_REGISTERED_TOPIC, RELAY_REMOVED_TOPIC]],
            "fromBlock": hex(from_block),
            "toBlock": hex(to_block),
        }],
        "id": 1,
    }
    resp = client.post(rpc_url, json=payload, timeout=15)
    events = resp.json().get("result", [])
    registered = [e for e in events if e.get("topics", [""])[0] == RELAY_REGISTERED_TOPIC]
    removed = [e for e in events if e.get("topics", [""])[0] == RELAY_REMOVED_TOPIC]
    return registered, removed


def _decode_event(event: dict) -> tuple[str, str | None]:
    """Decode an event into (operator_address, url_or_None_for_removal)."""
    topics = event.get("topics", [])
    if len(topics) < 2:
        return "", None
    op = "0x" + topics[1][-40:].lower()
    data = event.get("data", "0x")
    url = None
    if len(data) > 130:
        try:
            url_hex = data[130:]
            url = bytes.fromhex(url_hex).decode("utf-8").rstrip("\x00")
        except Exception:
            pass
    return op, url


def _apply_events(events: list[dict], event_type: str):
    """Update _operator_states with events. Only keeps the latest per operator."""
    global _operator_states
    for event in events:
        block = int(event.get("blockNumber", "0x0"), 16)
        op, url = _decode_event(event)
        if not op:
            continue
        prev = _operator_states.get(op)
        if prev is None or block > prev["block"]:
            _operator_states[op] = {"block": block, "status": event_type, "url": url}


def _sync_events():
    """Incrementally sync relay events from chain.

    First sync queries full history (fast when event count is low).
    Subsequent syncs only fetch new blocks since last checkpoint.
    Falls back to batch querying if full range is rejected by RPC.
    """
    global _last_synced_block

    client = _get_client()
    current_block = _get_current_block(client)
    if current_block == 0:
        return

    if _last_synced_block == 0:
        from_block = 0
    else:
        from_block = _last_synced_block + 1

    if from_block >= current_block:
        return

    for rpc_url in ARBITRUM_RPCS:
        try:
            # Try full range first (works when event count fits within RPC result limit)
            registered, removed = _query_events_batch(client, rpc_url, from_block, current_block)
            _apply_events(registered, "registered")
            _apply_events(removed, "removed")
            _last_synced_block = current_block
            return
        except Exception:
            # Full range failed — batch through smaller chunks
            pass

        try:
            batch_start = from_block
            while batch_start <= current_block:
                batch_end = min(batch_start + BATCH_BLOCK_RANGE - 1, current_block)
                registered, removed = _query_events_batch(client, rpc_url, batch_start, batch_end)
                _apply_events(registered, "registered")
                _apply_events(removed, "removed")
                batch_start = batch_end + 1
            _last_synced_block = current_block
            return
        except Exception:
            continue


def _discover_relays() -> list[str]:
    """Query RelayRegistered events, filter by IP region, sample + ping for nearest."""
    global _discovered_relays, _relays_cache_time

    # If we already have a working relay, keep using it (progressive)
    if _discovered_relays and time.time() - _relays_cache_time < 300:
        return _discovered_relays

    if RELAY_REGISTRY == "0x0000000000000000000000000000000000000000":
        return []

    # Incremental sync from chain → updates _operator_states
    _sync_events()

    # Build active relay list from synced operator states
    all_relays: list[str] = []
    for op, state in _operator_states.items():
        if state["status"] == "registered" and state["url"]:
            all_relays.append(state["url"])

    if not all_relays:
        return _discovered_relays

    # ── Smart selection: region filter → sample → ping ──
    my_ip = _get_public_ip()
    my_prefix = _ip_prefix(my_ip)

    # Step 1: Group by IP prefix (same /16 = same region)
    same_region = [r for r in all_relays if _ip_prefix(r) == my_prefix]
    other_region = [r for r in all_relays if _ip_prefix(r) != my_prefix]

    # Step 2: Prefer same region, but limit to reasonable sample size
    import random
    sample_size = 10
    if len(same_region) <= sample_size:
        candidates = list(same_region)
        remaining = sample_size - len(same_region)
        if remaining > 0 and other_region:
            candidates += random.sample(other_region, min(remaining, len(other_region)))
    else:
        candidates = random.sample(same_region, sample_size)

    # Step 3: Ping candidates, pick fastest
    results = [_measure_latency(r) for r in candidates]
    results.sort(key=lambda x: x[1])
    winners = [r[0] for r in results if r[1] < float("inf")]

    if winners:
        _discovered_relays = winners
        _relays_cache_time = time.time()
        return winners

    return _discovered_relays


def _get_relay_url() -> str:
    # Priority: explicit state > env var > on-chain discovery (nearest first) > localhost
    if _state["relay_url"]:
        return _state["relay_url"].rstrip("/")
    env_url = os.environ.get("TALKEN_RELAY_URL", "")
    if env_url:
        return env_url.rstrip("/")
    discovered = _discover_relays()
    if discovered:
        _state["relay_url"] = discovered[0]  # nearest
        return discovered[0].rstrip("/")
    return "http://localhost:3001"


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
    client = _get_client()
    url = f"{_get_relay_url()}/api/v1{path}"
    timestamp = str(int(time.time() * 1000))

    headers = {
        "X-Talken-Agent-Id": _state["agent_id"] or "",
        "X-Talken-Timestamp": timestamp,
    }

    body_str = json.dumps(body) if body else None
    if body_str:
        headers["Content-Type"] = "application/json"

    if _state["private_key"]:
        sig = _sign_request(method, f"/api/v1{path}", timestamp, body_str)
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


def talken_discover_relays(args: dict, **kwargs) -> str:
    relays = _discover_relays()
    # Re-measure latencies for fresh results
    results = [_measure_latency(r) for r in relays]
    results.sort(key=lambda x: x[1])
    relay_info = [
        {"url": r[0], "latency_ms": round(r[1], 1) if r[1] < float("inf") else "timeout"}
        for r in results
    ]
    return json.dumps({
        "success": True,
        "relays": relay_info,
        "nearest": relay_info[0]["url"] if relay_info else None,
        "count": len(relay_info),
        "source": "on-chain (Arbitrum) + latency sorted" if relays else "none",
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
