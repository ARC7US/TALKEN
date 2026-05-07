/**
 * MCP Tool call handler for TALKEN.
 * Maps tool calls to TalkenClient method invocations.
 */

import { TalkenClient, type AgentRole } from "../../agent-sdk/src/client.js";

let client: TalkenClient | null = null;

export function getClient(): TalkenClient | null {
  return client;
}

export function initClient(options: {
  baseUrl: string;
  agentId: string;
  skills?: string[];
}): TalkenClient {
  client = new TalkenClient({
    baseUrl: options.baseUrl,
    agentId: options.agentId,
    skills: options.skills ?? [],
  });
  return client;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: string }> {
  if (!client) {
    return { content: "错误: TALKEN 客户端未初始化。请设置 TALKEN_URL 和 TALKEN_AGENT_ID 环境变量。" };
  }

  try {
    switch (name) {
      case "talken_switch_role": {
        const role = args.role as AgentRole;
        client.setRole(role);
        client.start();
        return { content: `已切换到 ${role} 模式并开始运行` };
      }

      case "talken_publish_task": {
        const task = await client.publishTask({
          skill: args.skill as string,
          params: { description: args.description as string },
          fee: args.fee as number,
          complexity: args.complexity as number | undefined,
        });
        return { content: `任务已发布: ${task.id}\n技能: ${task.skill}\n费用: ${task.fee} TALKEN\n状态: ${task.status}` };
      }

      case "talken_accept_task": {
        if (args.taskId) {
          const task = await client.acceptTask(args.taskId as string);
          return { content: `已接取任务: ${task.id} (${task.skill})` };
        }
        const tasks = await client.listTasks({ status: "published", limit: 1 });
        if (tasks.length === 0) return { content: "当前没有可接取的任务" };
        const task = await client.acceptTask(tasks[0].id);
        return { content: `已自动接取任务: ${task.id} (${task.skill})` };
      }

      case "talken_submit_result": {
        const result = await client.submitResult(args.taskId as string, {
          content: args.content as string,
        });
        return { content: `结果已提交: 任务 ${result.task.id}\n已分配 ${result.validators.length} 个 Validator 验证` };
      }

      case "talken_vote": {
        const result = await client.voteOnTask(args.taskId as string, args.passed as boolean);
        let msg = `已投票: ${args.passed ? "通过" : "不通过"}`;
        if (result.aggregating) {
          msg += `\n正在汇总中...`;
        }
        return { content: msg };
      }

      case "talken_check_balance": {
        const profile = await client.getProfile();
        return {
          content: [
            `余额: ${profile.balance} TALKEN`,
            `质押: ${profile.stakeAmount} TALKEN`,
            `声誉: ${profile.reputation}`,
            `已完成任务: ${profile.completedTasks}`,
            `已发布任务: ${profile.publishedTasks}`,
            `验证次数: ${profile.validationCount}`,
          ].join("\n"),
        };
      }

      case "talken_list_tasks": {
        const tasks = await client.listTasks({
          status: args.status as string | undefined,
          limit: (args.limit as number) ?? 10,
        });
        if (tasks.length === 0) return { content: "没有找到任务" };
        const lines = tasks.map(
          (t, i) => `${i + 1}. [${t.id}] ${t.skill} - ${t.status} - ${t.fee} TALKEN`,
        );
        return { content: lines.join("\n") };
      }

      case "talken_stake": {
        const agent = await client.stake(args.amount as number);
        return { content: `已质押 ${args.amount} TALKEN\n当前总质押: ${agent.stakeAmount} TALKEN\n当前余额: ${agent.balance} TALKEN` };
      }

      case "talken_handle_message": {
        const msg = await client.handleNaturalLanguage(args.message as string);
        return { content: msg };
      }

      default:
        return { content: `未知工具: ${name}` };
    }
  } catch (err: any) {
    return { content: `操作失败: ${err.message}` };
  }
}
