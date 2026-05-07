"""TALKEN tools for Hermes Agent."""

from __future__ import annotations

import os
from typing import Any

from talken.client import TalkenClient, TalkenError
from tools.registry import tool_error, tool_result


def _get_client() -> TalkenClient:
    return TalkenClient()


def _talken_error(exc: Exception) -> str:
    if isinstance(exc, TalkenError):
        return tool_error(str(exc))
    return tool_error(f"TALKEN error: {type(exc).__name__}: {exc}")


# ── Handlers ────────────────────────────────────────────────────────────


def _handle_switch_role(args: dict, **kw) -> str:
    role = str(args.get("role") or "").strip().lower()
    if role not in ("publisher", "executor", "validator"):
        return tool_error("role must be one of: publisher, executor, validator")
    try:
        client = _get_client()
        client.set_role(role)
        return tool_result({
            "success": True,
            "role": role,
            "message": f"Switched to {role} mode on TALKEN",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_publish_task(args: dict, **kw) -> str:
    skill = str(args.get("skill") or "").strip()
    description = str(args.get("description") or "").strip()
    fee = args.get("fee")
    if not skill:
        return tool_error("skill is required")
    if not description:
        return tool_error("description is required")
    if fee is None:
        return tool_error("fee is required (in TALKEN tokens)")
    try:
        client = _get_client()
        task = client.publish_task(
            skill=skill,
            description=description,
            fee=float(fee),
            complexity=args.get("complexity"),
        )
        task_data = task.get("data", task)
        return tool_result({
            "success": True,
            "task_id": task_data.get("id"),
            "skill": skill,
            "fee": float(fee),
            "status": task_data.get("status", "published"),
            "message": f"Task published: {task_data.get('id')}",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_accept_task(args: dict, **kw) -> str:
    task_id = str(args.get("task_id") or args.get("taskId") or "").strip()
    if not task_id:
        # Auto-pick first available task
        try:
            client = _get_client()
            tasks = client.list_tasks(status="published", limit=1)
            if not tasks:
                return tool_result({"success": False, "message": "No available tasks to accept"})
            task_id = tasks[0].get("id", "")
        except Exception as exc:
            return _talken_error(exc)
    try:
        client = _get_client()
        task = client.accept_task(task_id)
        task_data = task.get("data", task)
        return tool_result({
            "success": True,
            "task_id": task_id,
            "skill": task_data.get("skill"),
            "message": f"Accepted task: {task_id}",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_submit_result(args: dict, **kw) -> str:
    task_id = str(args.get("task_id") or args.get("taskId") or "").strip()
    content = str(args.get("content") or "").strip()
    if not task_id:
        return tool_error("task_id is required")
    if not content:
        return tool_error("content is required")
    try:
        client = _get_client()
        result = client.submit_result(task_id, content)
        result_data = result.get("data", result)
        validators = result_data.get("validators", [])
        return tool_result({
            "success": True,
            "task_id": task_id,
            "validators_assigned": len(validators),
            "message": f"Result submitted for task {task_id}, {len(validators)} validators assigned",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_vote(args: dict, **kw) -> str:
    task_id = str(args.get("task_id") or args.get("taskId") or "").strip()
    passed_raw = args.get("passed")
    if not task_id:
        return tool_error("task_id is required")
    if passed_raw is None:
        return tool_error("passed is required (true/false)")
    passed = bool(passed_raw)
    try:
        client = _get_client()
        result = client.vote(task_id, passed)
        result_data = result.get("data", result)
        return tool_result({
            "success": True,
            "task_id": task_id,
            "vote": "PASS" if passed else "FAIL",
            "aggregating": result_data.get("aggregating", False),
            "message": f"Voted {'PASS' if passed else 'FAIL'} on task {task_id}",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_check_balance(args: dict, **kw) -> str:
    try:
        client = _get_client()
        profile = client.get_balance()
        data = profile.get("data", profile)
        return tool_result({
            "success": True,
            "agent_id": data.get("id"),
            "balance": data.get("balance", 0),
            "stake_amount": data.get("stakeAmount", 0),
            "reputation": data.get("reputation", 0),
            "completed_tasks": data.get("completedTasks", 0),
            "published_tasks": data.get("publishedTasks", 0),
            "message": f"Balance: {data.get('balance', 0)} TALKEN | Staked: {data.get('stakeAmount', 0)} | Reputation: {data.get('reputation', 0)}",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_list_tasks(args: dict, **kw) -> str:
    status = args.get("status")
    limit = int(args.get("limit", 10))
    try:
        client = _get_client()
        tasks = client.list_tasks(status=status, limit=limit)
        if not tasks:
            return tool_result({"success": True, "tasks": [], "message": "No tasks found"})
        task_list = []
        for t in tasks:
            task_list.append({
                "id": t.get("id"),
                "skill": t.get("skill"),
                "status": t.get("status"),
                "fee": t.get("fee"),
            })
        return tool_result({
            "success": True,
            "count": len(task_list),
            "tasks": task_list,
            "message": f"Found {len(task_list)} tasks",
        })
    except Exception as exc:
        return _talken_error(exc)


def _handle_stake(args: dict, **kw) -> str:
    amount = args.get("amount")
    if amount is None:
        return tool_error("amount is required")
    try:
        client = _get_client()
        result = client.stake(float(amount))
        data = result.get("data", result)
        return tool_result({
            "success": True,
            "staked": float(amount),
            "total_stake": data.get("stakeAmount", 0),
            "balance": data.get("balance", 0),
            "message": f"Staked {amount} TALKEN. Total stake: {data.get('stakeAmount', 0)}",
        })
    except Exception as exc:
        return _talken_error(exc)


# ── Schemas ─────────────────────────────────────────────────────────────

TALKEN_SWITCH_ROLE_SCHEMA = {
    "name": "talken_switch_role",
    "description": "Switch your role on the TALKEN network. Publisher: publish tasks. Executor: accept and complete tasks to earn TALKEN. Validator: verify task results.",
    "parameters": {
        "type": "object",
        "properties": {
            "role": {
                "type": "string",
                "enum": ["publisher", "executor", "validator"],
                "description": "The role to switch to",
            },
        },
        "required": ["role"],
    },
}

TALKEN_PUBLISH_TASK_SCHEMA = {
    "name": "talken_publish_task",
    "description": "Publish a new task to the TALKEN network. Other agents can accept and complete it.",
    "parameters": {
        "type": "object",
        "properties": {
            "skill": {"type": "string", "description": "Required skill for the task (e.g. search, code, analyze, translate)"},
            "description": {"type": "string", "description": "Task description — be specific about what needs to be done"},
            "fee": {"type": "number", "description": "Payment in TALKEN tokens"},
            "complexity": {"type": "number", "description": "Task complexity 0.0-5.0 (auto-determined if omitted)"},
        },
        "required": ["skill", "description", "fee"],
    },
}

TALKEN_ACCEPT_TASK_SCHEMA = {
    "name": "talken_accept_task",
    "description": "Accept an available task on TALKEN. Provide a task_id or leave empty to auto-accept the first available task matching your skills.",
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "Task ID to accept (omit to auto-pick)"},
        },
    },
}

TALKEN_SUBMIT_RESULT_SCHEMA = {
    "name": "talken_submit_result",
    "description": "Submit your completed result for a task you accepted.",
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "The task ID"},
            "content": {"type": "string", "description": "The result content"},
        },
        "required": ["task_id", "content"],
    },
}

TALKEN_VOTE_SCHEMA = {
    "name": "talken_vote",
    "description": "Vote on a task result as a validator. Use when you have been selected to verify a task.",
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {"type": "string", "description": "The task ID to vote on"},
            "passed": {"type": "boolean", "description": "true = result is good, false = result is bad"},
        },
        "required": ["task_id", "passed"],
    },
}

TALKEN_CHECK_BALANCE_SCHEMA = {
    "name": "talken_check_balance",
    "description": "Check your TALKEN token balance, stake amount, and reputation.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

TALKEN_LIST_TASKS_SCHEMA = {
    "name": "talken_list_tasks",
    "description": "List tasks on the TALKEN network, optionally filtered by status.",
    "parameters": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "description": "Filter by status: published, accepted, submitted, verified, settled"},
            "limit": {"type": "integer", "description": "Max tasks to return (default 10)"},
        },
    },
}

TALKEN_STAKE_SCHEMA = {
    "name": "talken_stake",
    "description": "Stake TALKEN tokens to become a validator. Minimum stake required to participate in verification.",
    "parameters": {
        "type": "object",
        "properties": {
            "amount": {"type": "number", "description": "Amount of TALKEN to stake"},
        },
        "required": ["amount"],
    },
}
