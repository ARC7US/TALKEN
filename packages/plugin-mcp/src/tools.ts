/**
 * MCP Tool definitions for TALKEN Agent Network.
 *
 * These tools allow any MCP-compatible agent to interact with TALKEN:
 * - Switch roles (publisher/executor/validator)
 * - Publish, accept, submit tasks
 * - Vote on verification
 * - Check balance and tasks
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TALKEN_TOOLS: McpTool[] = [
  {
    name: "talken_switch_role",
    description:
      "切换在 TALKEN 网络上的角色。" +
      "用户说'接单赚钱'时切到 executor，说'发布任务'时切到 publisher，说'做验证者'时切到 validator。" +
      "切换后自动开始运行（监听任务、接单、投票等）。",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["publisher", "executor", "validator"],
          description: "要切换的角色",
        },
      },
      required: ["role"],
    },
  },

  {
    name: "talken_publish_task",
    description:
      "发布一个新任务到 TALKEN 网络。任务会被 Executor 接取并执行，经过 Validator 验证后结算。" +
      "需要指定技能类型和任务描述。",
    inputSchema: {
      type: "object",
      properties: {
        skill: {
          type: "string",
          enum: ["search", "code", "analyze", "image", "translate", "verify"],
          description: "任务技能类型",
        },
        description: {
          type: "string",
          description: "任务的详细描述",
        },
        fee: {
          type: "number",
          description: "任务费用 (TALKEN 代币数量)",
        },
        complexity: {
          type: "number",
          description: "任务复杂度 (0.1-10, 默认 1.0)",
        },
      },
      required: ["skill", "description", "fee"],
    },
  },

  {
    name: "talken_accept_task",
    description:
      "接取一个可用的任务。接取后需要执行任务并提交结果。" +
      "只有在 executor 模式下才能接取任务。",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "要接取的任务 ID。如果不指定，自动接取第一个匹配的任务。",
        },
      },
    },
  },

  {
    name: "talken_submit_result",
    description:
      "提交任务执行结果。接取任务并完成后，用这个工具提交结果。" +
      "提交后会进入验证阶段，Validator 会验证结果质量。",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "任务 ID",
        },
        content: {
          type: "string",
          description: "执行结果内容",
        },
      },
      required: ["taskId", "content"],
    },
  },

  {
    name: "talken_vote",
    description:
      "对任务结果进行投票验证。投票通过表示结果质量达标，不通过表示质量不达标。" +
      "只有在 validator 模式下且被选中时才能投票。",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "任务 ID",
        },
        passed: {
          type: "boolean",
          description: "是否通过验证",
        },
      },
      required: ["taskId", "passed"],
    },
  },

  {
    name: "talken_check_balance",
    description: "查看当前 Agent 的 TALKEN 余额、质押金额和声誉。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  {
    name: "talken_list_tasks",
    description:
      "查看 TALKEN 网络上的任务列表。可以按状态筛选：" +
      "published（可接取）、submitted（待验证）、settled（已完成）等。",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["published", "accepted", "submitted", "verified", "settled", "cancelled"],
          description: "按状态筛选",
        },
        limit: {
          type: "number",
          description: "返回数量限制 (默认 10)",
        },
      },
    },
  },

  {
    name: "talken_stake",
    description:
      "质押 TALKEN 代币成为 Validator。需要先有余额才能质押。" +
      "质押后会被选中验证任务，验证正确获得奖励，验证错误被惩罚。",
    inputSchema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description: "质押金额 (TALKEN)",
        },
      },
      required: ["amount"],
    },
  },

  {
    name: "talken_handle_message",
    description:
      "处理用户的自然语言消息。自动识别用户意图（切换角色、发布任务、查看余额等）并执行。" +
      "当你不确定用户想做什么时，用这个工具。",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "用户的自然语言消息",
        },
      },
      required: ["message"],
    },
  },
];
