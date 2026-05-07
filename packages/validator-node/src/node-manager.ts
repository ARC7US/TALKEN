/**
 * Node Manager
 * Handles the validator node lifecycle:
 * - Registration with TALKEN network
 * - Staking
 * - Task reception and voting
 * - Heartbeat
 */

import { TalkenClient, type AgentRole } from "../../agent-sdk/src/client.js";
import type { ValidatorConfig } from "./config.js";
import { scoreTask, type TaskToScore } from "./scoring-engine.js";
import type { Task } from "@talken/shared";

export interface NodeStatus {
  agentId: string;
  role: AgentRole;
  balance: number;
  stakeAmount: number;
  reputation: number;
  isRunning: boolean;
  tasksScored: number;
  uptime: number;
}

export class NodeManager {
  private client: TalkenClient;
  private config: ValidatorConfig;
  private tasksScored = 0;
  private startTime = 0;
  private running = false;

  constructor(config: ValidatorConfig) {
    this.config = config;
    this.client = new TalkenClient({
      baseUrl: config.network.server_url,
      agentId: config.node.name,
      skills: ["verify"],
      pollInterval: 3000,
    });
  }

  /**
   * Initialize: register with TALKEN network and stake tokens.
   */
  async init(): Promise<void> {
    console.log("正在注册 Validator...");

    // Register agent
    await this.client.register({
      name: this.config.node.name,
      skills: ["verify"],
    });

    console.log(`已注册: ${this.config.node.name}`);

    // Check current stake
    const profile = await this.client.getProfile();
    if (profile.stakeAmount < this.config.staking.amount) {
      const needed = this.config.staking.amount - profile.stakeAmount;
      if (profile.balance >= needed) {
        console.log(`正在质押 ${this.config.staking.amount} TALKEN...`);
        await this.client.stake(this.config.staking.amount);
        console.log("质押完成");
      } else {
        console.warn(`余额不足: 需要 ${needed} TALKEN，当前余额 ${profile.balance} TALKEN`);
        console.warn("请先向此地址转入 TALKEN 代币");
      }
    } else {
      console.log(`已质押: ${profile.stakeAmount} TALKEN`);
    }
  }

  /**
   * Start the validator node.
   * Begins listening for tasks and scoring them.
   */
  async start(): Promise<void> {
    this.startTime = Date.now();
    this.running = true;

    console.log(`Validator 节点启动: ${this.config.node.name}`);
    console.log(`LLM 提供商: ${this.config.llm.default_provider}`);
    console.log(`服务器: ${this.config.network.server_url}`);

    // Set up task verification handler
    this.client.onVerification(async (taskId, task) => {
      await this.handleTask(taskId, task);
    });

    // Start polling
    this.client.setRole("validator");
    this.client.start();

    console.log("开始监听任务...");
  }

  /**
   * Stop the validator node.
   */
  stop(): void {
    this.running = false;
    this.client.stop();
    console.log("Validator 节点已停止");
  }

  /**
   * Handle a task verification request.
   * Uses LLM to score the result and votes accordingly.
   */
  private async handleTask(taskId: string, task: Task): Promise<void> {
    console.log(`\n收到验证任务: ${taskId} (${task.skill})`);

    try {
      // Build task data for scoring
      const taskData: TaskToScore = {
        taskId: task.id,
        skill: task.skill,
        description: (task.params as any)?.description ?? task.skill,
        params: task.params as Record<string, unknown>,
        executorResult: (task.result as any)?.content ?? JSON.stringify(task.result),
      };

      // Score with LLM
      console.log("正在调用 LLM 评分...");
      const result = await scoreTask(this.config, taskData);

      console.log(`评分完成: ${result.passed ? "通过" : "不通过"} (${result.score}/100)`);
      console.log(`理由: ${result.reason}`);

      // Vote
      const voteResult = await this.client.voteOnTask(taskId, result.passed);
      console.log(`已投票: ${result.passed ? "通过" : "不通过"}`);

      if (voteResult.aggregating) {
        console.log("正在等待汇总...");
      }

      this.tasksScored++;
    } catch (err: any) {
      console.error(`验证任务 ${taskId} 失败: ${err.message}`);
    }
  }

  /**
   * Get current node status.
   */
  async getStatus(): Promise<NodeStatus> {
    const profile = await this.client.getProfile();

    return {
      agentId: this.config.node.name,
      role: this.client.getRole() ?? "validator",
      balance: profile.balance,
      stakeAmount: profile.stakeAmount,
      reputation: profile.reputation,
      isRunning: this.running,
      tasksScored: this.tasksScored,
      uptime: this.running ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Format node status for display.
   */
  async formatStatus(): Promise<string> {
    const status = await this.getStatus();
    const uptimeStr = status.isRunning
      ? formatDuration(status.uptime)
      : "已停止";

    return [
      "Validator 节点状态:",
      `  名称: ${status.agentId}`,
      `  角色: ${status.role}`,
      `  余额: ${status.balance} TALKEN`,
      `  质押: ${status.stakeAmount} TALKEN`,
      `  声誉: ${status.reputation}`,
      `  已评分任务: ${status.tasksScored}`,
      `  运行时间: ${uptimeStr}`,
      `  状态: ${status.isRunning ? "运行中 ✓" : "已停止 ✗"}`,
    ].join("\n");
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
  return `${seconds}秒`;
}
