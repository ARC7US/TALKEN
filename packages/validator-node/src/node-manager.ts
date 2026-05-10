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
  private tasksScored = 0;
  private startTime = 0;
  private running = false;

  constructor(config: ValidatorConfig) {
    this.config = config;
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
    const privateKey = process.env.TALKEN_WALLET_PRIVATE_KEY;
    if (!privateKey) {
      console.log("No TALKEN_WALLET_PRIVATE_KEY set, skipping on-chain registration");
      console.log("To register: talken-validator stake --url ws://<your-ip>:1789");
      return;
    }

    const port = this.config.network.listen_port || 1789;
    const relayUrl = this.config.network.server_url || `ws://0.0.0.0:${port}`;

    try {
      const { stakeAndRegister } = await import("./staking.js");
      console.log(`Registering on-chain with URL: ${relayUrl}...`);
      const result = await stakeAndRegister(privateKey, relayUrl);
      if (result.success) {
        console.log(`On-chain registration complete. TX: ${result.txHash}`);
      } else {
        console.warn(`On-chain registration skipped: ${result.error}`);
      }
    } catch (e: any) {
      console.warn(`On-chain registration failed: ${e.message}`);
      console.warn("Node will still work via direct WebSocket connections");
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
