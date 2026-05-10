/**
 * Node Manager
 * Handles the validator node lifecycle:
 * - Start relay server (WebSocket on port 1789)
 * - Register on-chain via RelayRegistry contract
 * - Receive tasks from publishers
 * - Score results using LLM
 * - Manage staking and reputation
 */

import type { ValidatorConfig } from "./config.js";
import { RelayServer } from "./relay-server.js";
import { scoreTask, type TaskToScore } from "./scoring-engine.js";

export interface NodeStatus {
  nodeId: string;
  port: number;
  clients: number;
  tasks: number;
  tasksScored: number;
  isRunning: boolean;
  uptime: number;
  staked: number;
  reputation: number;
}

export class NodeManager {
  private config: ValidatorConfig;
  private relay: RelayServer;
  private privateKey: string | null;
  private tasksScored = 0;
  private startTime = 0;
  private running = false;

  constructor(config: ValidatorConfig, privateKey?: string) {
    this.config = config;
    this.privateKey = privateKey || null;
    const port = config.network.listen_port || 1789;
    this.relay = new RelayServer(config, port);
  }

  /**
   * Initialize: check staking, prepare node.
   */
  async init(): Promise<void> {
    console.log("Initializing validator node...");

    // Check hardware
    const { checkHardware } = await import("./hardware-check.js");
    const hwReport = checkHardware();
    if (!hwReport.passed) {
      throw new Error("Hardware requirements not met");
    }

    console.log(`Node name: ${this.config.node.name}`);
    console.log(`LLM provider: ${this.config.llm.default_provider}`);
    console.log(`Listen port: ${this.config.network.listen_port || 1789}`);
  }

  /**
   * Start the relay server and begin accepting connections.
   */
  async start(): Promise<void> {
    this.startTime = Date.now();
    this.running = true;

    // Start WebSocket relay server
    this.relay.start();

    console.log(`\nValidator node running`);
    console.log(`Publishers connect via: ws://<your-ip>:${this.config.network.listen_port || 1789}`);
    console.log(`Waiting for tasks...\n`);

    // Register on-chain if contract address is set
    await this.registerOnChain();
  }

  /**
   * Stop the relay server.
   */
  stop(): void {
    this.running = false;
    this.relay.stop();
    console.log("Validator node stopped");
  }

  /**
   * Register this node on the RelayRegistry contract.
   */
  private async registerOnChain(): Promise<void> {
    if (!this.privateKey) {
      console.log("No private key available, skipping on-chain registration check");
      return;
    }

    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      const key = this.privateKey.startsWith("0x") ? this.privateKey : `0x${this.privateKey}`;
      const account = privateKeyToAccount(key as `0x${string}`);

      const { checkStakeStatus } = await import("./staking.js");
      const status = await checkStakeStatus(account.address);

      if (status.staked) {
        console.log(`节点已质押注册 (${account.address})`);
      } else {
        console.warn("节点尚未质押。请运行 `talken-validator stake` 完成质押。");
      }
    } catch (e: any) {
      console.warn(`链上状态检查失败: ${e.message}`);
    }
  }

  /**
   * Get current node status.
   */
  getStatus(): NodeStatus {
    return {
      nodeId: this.config.node.name,
      port: this.config.network.listen_port || 1789,
      clients: 0, // Will be populated from relay server
      tasks: 0,
      tasksScored: this.tasksScored,
      isRunning: this.running,
      uptime: this.running ? Date.now() - this.startTime : 0,
      staked: this.config.staking.amount,
      reputation: 0,
    };
  }

  /**
   * Format node status for display.
   */
  formatStatus(): string {
    const status = this.getStatus();
    const uptimeStr = status.isRunning ? formatDuration(status.uptime) : "Stopped";

    return [
      "Validator Node Status:",
      `  Name:     ${status.nodeId}`,
      `  Port:     ${status.port}`,
      `  Status:   ${status.isRunning ? "Running" : "Stopped"}`,
      `  Uptime:   ${uptimeStr}`,
      `  Staked:   ${status.staked} TALKEN`,
      `  Scored:   ${status.tasksScored} tasks`,
      `  LLM:      ${this.config.llm.default_provider} (${this.config.llm.providers[this.config.llm.default_provider]?.model})`,
    ].join("\n");
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
