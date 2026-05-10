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


def _get_relay_url() -> str:
    url = _state["relay_url"] or os.environ.get("TALKEN_RELAY_URL", "http://localhost:3001")
    return url.rstrip("/")


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
