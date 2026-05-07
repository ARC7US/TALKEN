#!/usr/bin/env node

/**
 * TALKEN Validator Node CLI
 *
 * Usage:
 *   talken-validator init     - 初始化配置
 *   talken-validator start   - 启动节点
 *   talken-validator status  - 查看状态
 *   talken-validator check   - 检查硬件
 */

import { loadConfig, saveConfig, resolveEnvVars, type ValidatorConfig } from "./config.js";
import { checkHardware, formatHardwareReport } from "./hardware-check.js";
import { NodeManager } from "./node-manager.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

async function main() {
  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "start":
      await cmdStart();
      break;
    case "status":
      await cmdStatus();
      break;
    case "check":
      cmdCheck();
      break;
    case "help":
    case "--help":
    case "-h":
      cmdHelp();
      break;
    default:
      console.error(`未知命令: ${command}`);
      cmdHelp();
      process.exit(1);
  }
}

// ── Commands ─────────────────────────────────────────────────────────────

function cmdHelp(): void {
  console.log(`
TALKEN Validator Node

命令:
  init      初始化配置文件 (validator-config.yaml)
  start     启动验证节点
  status    查看节点状态
  check     检查硬件是否满足要求
  help      显示帮助信息

环境变量:
  TALKEN_URL              服务器地址 (默认: http://localhost:3001)
  TALKEN_AGENT_ID         节点名称 (默认: 自动生成)
  OPENAI_API_KEY          OpenAI API Key
  ANTHROPIC_API_KEY       Anthropic API Key
  DEEPSEEK_API_KEY        DeepSeek API Key

示例:
  talken-validator init
  talken-validator check
  OPENAI_API_KEY=sk-xxx talken-validator start
`);
}

function cmdCheck(): void {
  const report = checkHardware();
  console.log(formatHardwareReport(report));
  if (!report.passed) {
    process.exit(1);
  }
}

async function cmdInit(): Promise<void> {
  const configPath = getConfigPath();
  const config = loadConfig(configPath);

  // Fill in environment variables
  if (process.env.TALKEN_URL) config.network.server_url = process.env.TALKEN_URL;
  if (process.env.TALKEN_AGENT_ID) config.node.name = process.env.TALKEN_AGENT_ID;

  saveConfig(config, configPath);
  console.log(`配置文件已生成: ${configPath}`);
  console.log("请编辑配置文件，填入 LLM API Key 等信息。");
  console.log(`\n当前配置:`);
  console.log(`  节点名称: ${config.node.name}`);
  console.log(`  服务器: ${config.network.server_url}`);
  console.log(`  LLM 提供商: ${config.llm.default_provider}`);
}

async function cmdStart(): Promise<void> {
  // Hardware check
  const hwReport = checkHardware();
  console.log(formatHardwareReport(hwReport));
  if (!hwReport.passed) {
    console.error("\n硬件不满足最低要求，无法启动。");
    process.exit(1);
  }

  // Load config
  const config = loadConfig();
  const resolved = resolveEnvVars(config) as ValidatorConfig;

  // Validate API key
  const provider = resolved.llm.providers[resolved.llm.default_provider];
  if (!provider?.api_key) {
    console.error(`\n错误: 未配置 ${resolved.llm.default_provider} 的 API Key。`);
    console.error("请在 validator-config.yaml 中设置，或通过环境变量传入。");
    process.exit(1);
  }

  // Start node
  const manager = new NodeManager(resolved);

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n正在停止节点...");
    manager.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n正在停止节点...");
    manager.stop();
    process.exit(0);
  });

  try {
    await manager.init();
    await manager.start();

    // Keep alive
    await new Promise(() => {});
  } catch (err: any) {
    console.error(`\n启动失败: ${err.message}`);
    process.exit(1);
  }
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  try {
    const manager = new NodeManager(config);
    const status = await manager.formatStatus();
    console.log(status);
  } catch (err: any) {
    console.error(`无法获取状态: ${err.message}`);
    console.error("确保节点正在运行，并且服务器可达。");
    process.exit(1);
  }
}

function getConfigPath(): string {
  const idx = args.indexOf("--config");
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return undefined as any;
}

// ── Run ──────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
