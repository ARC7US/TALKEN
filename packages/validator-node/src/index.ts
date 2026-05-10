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
import { stakeAndRegister, unstake, checkStakeStatus } from "./staking.js";

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
    case "stake":
      await cmdStake();
      break;
    case "unstake":
      await cmdUnstake();
      break;
    case "stake-status":
      await cmdStakeStatus();
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
  init          初始化配置文件 (validator-config.yaml)
  start         启动验证节点
  status        查看节点状态
  check         检查硬件是否满足要求
  stake         质押 TALKEN 并注册为中继节点
  unstake       解除质押并注销节点
  stake-status  查看质押状态
  help          显示帮助信息

环境变量:
  TALKEN_WALLET_PRIVATE_KEY  钱包私钥 (stake/unstake 必需)
  OPENAI_API_KEY             OpenAI API Key
  ANTHROPIC_API_KEY          Anthropic API Key
  DEEPSEEK_API_KEY           DeepSeek API Key

示例:
  talken-validator init
  talken-validator check
  TALKEN_WALLET_PRIVATE_KEY=0xabc... talken-validator stake --url ws://1.2.3.4:1789
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

async function cmdStake(): Promise<void> {
  const privateKey = process.env.TALKEN_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.error("错误: 请设置环境变量 TALKEN_WALLET_PRIVATE_KEY");
    console.error("示例: TALKEN_WALLET_PRIVATE_KEY=0xabc... talken-validator stake --url ws://1.2.3.4:1789");
    process.exit(1);
  }

  const urlIdx = args.indexOf("--url");
  const relayUrl = urlIdx !== -1 ? args[urlIdx + 1] : undefined;
  if (!relayUrl) {
    console.error("错误: 请指定中继地址 --url");
    console.error("示例: --url ws://1.2.3.4:1789");
    console.error("      --url https://relay.example.com:1789");
    process.exit(1);
  }

  try {
    console.log("=== TALKEN 中继节点质押 ===\n");
    const result = await stakeAndRegister(privateKey, relayUrl);
    if (result.success) {
      console.log(`\n质押成功！TX: ${result.txHash}`);
      console.log("你的节点已被注册到链上，其他 Agent 可以通过 RelayRegistry 发现你的节点。");
    } else {
      console.error(`\n质押失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n质押失败: ${err.message}`);
    process.exit(1);
  }
}

async function cmdUnstake(): Promise<void> {
  const privateKey = process.env.TALKEN_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    console.error("错误: 请设置环境变量 TALKEN_WALLET_PRIVATE_KEY");
    process.exit(1);
  }

  try {
    console.log("=== 解除质押 ===\n");
    const result = await unstake(privateKey);
    if (result.success) {
      console.log(`\n解除质押成功！TX: ${result.txHash}`);
      console.log("1000 TALKEN 已退还到你的钱包。");
    } else {
      console.error(`\n失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n失败: ${err.message}`);
    process.exit(1);
  }
}

async function cmdStakeStatus(): Promise<void> {
  const privateKey = process.env.TALKEN_WALLET_PRIVATE_KEY;
  const address = args[args.indexOf("--address") + 1];

  if (!privateKey && !address) {
    console.error("错误: 请设置 TALKEN_WALLET_PRIVATE_KEY 或使用 --address 指定地址");
    process.exit(1);
  }

  try {
    let addr = address;
    if (!addr && privateKey) {
      const { privateKeyToAccount } = await import("viem/accounts");
      const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
      addr = privateKeyToAccount(key as `0x${string}`).address;
    }

    const status = await checkStakeStatus(addr!);
    console.log("=== 质押状态 ===\n");
    console.log(`地址:     ${addr}`);
    console.log(`已质押:   ${status.staked ? "是" : "否"}`);
    console.log(`TALKEN:   ${status.balance}`);
  } catch (err: any) {
    console.error(`查询失败: ${err.message}`);
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
