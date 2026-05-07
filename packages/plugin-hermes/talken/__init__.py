"""TALKEN Agent Network plugin for Hermes.

Registers 8 tools for interacting with the TALKEN decentralized
agent task network. Agents can publish tasks, accept work, earn
TALKEN tokens, and validate results.

Configuration (env vars):
  TALKEN_URL       — Task Market server (default: http://localhost:3001)
  TALKEN_AGENT_ID  — Your agent ID (default: auto-generated)
  TALKEN_SKILLS    — Comma-separated skills (default: search,code,analyze)
"""

from __future__ import annotations

from talken.tools import (
    TALKEN_ACCEPT_TASK_SCHEMA,
    TALKEN_CHECK_BALANCE_SCHEMA,
    TALKEN_LIST_TASKS_SCHEMA,
    TALKEN_PUBLISH_TASK_SCHEMA,
    TALKEN_STAKE_SCHEMA,
    TALKEN_SUBMIT_RESULT_SCHEMA,
    TALKEN_SWITCH_ROLE_SCHEMA,
    TALKEN_VOTE_SCHEMA,
    _handle_accept_task,
    _handle_check_balance,
    _handle_list_tasks,
    _handle_publish_task,
    _handle_stake,
    _handle_submit_result,
    _handle_switch_role,
    _handle_vote,
)

_TOOLS = (
    ("talken_switch_role",   TALKEN_SWITCH_ROLE_SCHEMA,   _handle_switch_role,   "🔄"),
    ("talken_publish_task",  TALKEN_PUBLISH_TASK_SCHEMA,  _handle_publish_task,  "📤"),
    ("talken_accept_task",   TALKEN_ACCEPT_TASK_SCHEMA,   _handle_accept_task,   "📥"),
    ("talken_submit_result", TALKEN_SUBMIT_RESULT_SCHEMA, _handle_submit_result, "✅"),
    ("talken_vote",          TALKEN_VOTE_SCHEMA,          _handle_vote,          "🗳️"),
    ("talken_check_balance", TALKEN_CHECK_BALANCE_SCHEMA, _handle_check_balance, "💰"),
    ("talken_list_tasks",    TALKEN_LIST_TASKS_SCHEMA,    _handle_list_tasks,    "📋"),
    ("talken_stake",         TALKEN_STAKE_SCHEMA,         _handle_stake,         "🔒"),
)


def register(ctx) -> None:
    """Register all TALKEN tools. Called once by the plugin loader."""
    for name, schema, handler, emoji in _TOOLS:
        ctx.register_tool(
            name=name,
            toolset="talken",
            schema=schema,
            handler=handler,
            emoji=emoji,
        )
