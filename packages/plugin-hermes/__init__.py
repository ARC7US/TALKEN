"""TALKEN hermes-agent plugin - Decentralized agent collaboration network."""

import os
from . import schemas, tools


def register(ctx):
    """Register TALKEN tools and hooks with hermes-agent."""

    # Check for required env var
    relay_url = os.environ.get("TALKEN_RELAY_URL")
    if not relay_url:
        # Allow running without relay URL for offline/testing mode
        pass

    # Register tools
    ctx.register_tool(
        name="talken_connect_wallet",
        toolset="talken",
        schema=schemas.TALKEN_CONNECT_WALLET,
        handler=tools.talken_connect_wallet,
    )

    ctx.register_tool(
        name="talken_set_role",
        toolset="talken",
        schema=schemas.TALKEN_SET_ROLE,
        handler=tools.talken_set_role,
    )

    ctx.register_tool(
        name="talken_publish_task",
        toolset="talken",
        schema=schemas.TALKEN_PUBLISH_TASK,
        handler=tools.talken_publish_task,
    )

    ctx.register_tool(
        name="talken_list_tasks",
        toolset="talken",
        schema=schemas.TALKEN_LIST_TASKS,
        handler=tools.talken_list_tasks,
    )

    ctx.register_tool(
        name="talken_accept_task",
        toolset="talken",
        schema=schemas.TALKEN_ACCEPT_TASK,
        handler=tools.talken_accept_task,
    )

    ctx.register_tool(
        name="talken_submit_result",
        toolset="talken",
        schema=schemas.TALKEN_SUBMIT_RESULT,
        handler=tools.talken_submit_result,
    )

    ctx.register_tool(
        name="talken_check_balance",
        toolset="talken",
        schema=schemas.TALKEN_CHECK_BALANCE,
        handler=tools.talken_check_balance,
    )

    ctx.register_tool(
        name="talken_get_role",
        toolset="talken",
        schema=schemas.TALKEN_GET_ROLE,
        handler=tools.talken_get_role,
    )

    # Register hook to inject TALKEN context into LLM calls
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)

    # Register slash command
    ctx.register_command("talken", _handle_talken_command, "TALKEN network operations")


def _on_pre_llm_call(**kwargs):
    """Inject TALKEN state context before each LLM call."""
    state = tools._state
    if state.get("agent_id"):
        role = state.get("role", "none")
        running = state.get("running", False)
        return {
            "context": (
                f"[TALKEN] Connected as {state.get('agent_name', 'unknown')} "
                f"(role: {role}, heartbeat: {'active' if running else 'inactive'}). "
                f"Use talken_* tools to interact with the TALKEN network."
            )
        }
    return None


def _handle_talken_command(args: str) -> str:
    """Handle /talken slash command."""
    parts = args.strip().split()
    if not parts:
        return (
            "TALKEN Network Commands:\n"
            "  /talken connect <private_key>  - Connect wallet\n"
            "  /talken role <publisher|executor> - Switch role\n"
            "  /talken status                 - Show current status\n"
            "  /talken balance                - Check balance\n"
            "  /talken tasks                  - List tasks\n"
        )

    cmd = parts[0].lower()

    if cmd == "status":
        import json
        return json.dumps(tools.talken_get_role({}), indent=2)

    if cmd == "balance":
        import json
        return json.dumps(tools.talken_check_balance({}), indent=2)

    return f"Unknown TALKEN command: {cmd}. Use /talken for help."
