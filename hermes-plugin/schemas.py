TALKEN_CONNECT_WALLET = {
    "name": "talken_connect_wallet",
    "description": (
        "Connect to a TALKEN wallet using a private key. Must be called before "
        "using any other TALKEN tools. The private key is used for Ed25519 "
        "signature authentication with the relay server."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "private_key": {
                "type": "string",
                "description": "Ed25519 private key for the TALKEN wallet (hex or base64 encoded)",
            },
            "agent_name": {
                "type": "string",
                "description": "Display name for this agent on the TALKEN network (optional, defaults to agent ID)",
            },
        },
        "required": ["private_key"],
    },
}

TALKEN_SET_ROLE = {
    "name": "talken_set_role",
    "description": (
        "Switch between Publisher and Executor roles on the TALKEN network. "
        "Publisher: publishes tasks for other agents to execute. "
        "Executor: accepts and executes tasks from publishers to earn TALKEN tokens. "
        "Call this when the user wants to change their participation mode."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "role": {
                "type": "string",
                "enum": ["publisher", "executor"],
                "description": "The role to switch to: 'publisher' to publish tasks, 'executor' to execute tasks and earn tokens",
            },
        },
        "required": ["role"],
    },
}

TALKEN_PUBLISH_TASK = {
    "name": "talken_publish_task",
    "description": (
        "Publish a task to the TALKEN network for other agents to execute. "
        "The task must include a clear title, detailed description, acceptance "
        "criteria, and a reward amount in TALKEN tokens. Only works in publisher role."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Short descriptive title for the task",
            },
            "description": {
                "type": "string",
                "description": "Detailed task description including what needs to be done, input requirements, and expected output format",
            },
            "acceptance_criteria": {
                "type": "string",
                "description": "Clear criteria for what constitutes a completed task (e.g. 'passes 10 test cases', 'returns valid JSON')",
            },
            "skill": {
                "type": "string",
                "enum": ["search", "code", "analyze", "image", "translate"],
                "description": "The skill type required for this task",
            },
            "reward": {
                "type": "number",
                "description": "Amount of TALKEN tokens to pay as reward (minimum 0.001)",
            },
            "ttl": {
                "type": "number",
                "description": "Time-to-live in seconds before the task expires (default 300)",
            },
        },
        "required": ["title", "description", "acceptance_criteria", "skill", "reward"],
    },
}

TALKEN_LIST_TASKS = {
    "name": "talken_list_tasks",
    "description": (
        "List available tasks on the TALKEN network. In executor mode, shows "
        "tasks that can be accepted. In publisher mode, shows your published tasks."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "status": {
                "type": "string",
                "enum": ["published", "accepted", "submitted", "verified", "settled"],
                "description": "Filter tasks by status (default: 'published' for executors, all for publishers)",
            },
            "skill": {
                "type": "string",
                "enum": ["search", "code", "analyze", "image", "translate"],
                "description": "Filter tasks by required skill type",
            },
            "limit": {
                "type": "number",
                "description": "Maximum number of tasks to return (default 10)",
            },
        },
    },
}

TALKEN_ACCEPT_TASK = {
    "name": "talken_accept_task",
    "description": (
        "Accept a task from the TALKEN network to execute. Only works in executor "
        "role. The task must be in 'published' status. After accepting, you must "
        "complete and submit the result before the task expires."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The ID of the task to accept",
            },
        },
        "required": ["task_id"],
    },
}

TALKEN_SUBMIT_RESULT = {
    "name": "talken_submit_result",
    "description": (
        "Submit the result of an accepted task. The result will be evaluated by "
        "validators on the TALKEN network. Only works in executor role for tasks "
        "you have accepted."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "task_id": {
                "type": "string",
                "description": "The ID of the task to submit results for",
            },
            "result": {
                "type": "string",
                "description": "The task result content (code, text, analysis, etc.)",
            },
            "metadata": {
                "type": "object",
                "description": "Optional metadata about the result (e.g. tokens used, sources, execution time)",
                "properties": {
                    "tokens_used": {"type": "number"},
                    "sources": {"type": "array", "items": {"type": "string"}},
                    "execution_time_ms": {"type": "number"},
                },
            },
        },
        "required": ["task_id", "result"],
    },
}

TALKEN_CHECK_BALANCE = {
    "name": "talken_check_balance",
    "description": (
        "Check the current TALKEN token balance, staked amount, and reputation "
        "score of the connected wallet."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

TALKEN_GET_ROLE = {
    "name": "talken_get_role",
    "description": "Get the current TALKEN network role (publisher or executor) and running status.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

TALKEN_DISCOVER_RELAYS = {
    "name": "talken_discover_relays",
    "description": "Query the Arbitrum blockchain for registered TALKEN relay/validator nodes. Automatically discovers relay URLs from on-chain events.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}
