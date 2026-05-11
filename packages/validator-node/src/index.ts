#!/usr/bin/env node

/**
 * TALKEN Validator Node CLI
 *
 * Usage:
 *   talken-validator init              - 初始化配置
 *   talken-validator start             - 启动节点（需要输入密码解密私钥）
 *   talken-validator status            - 查看状态
 *   talken-validator check             - 检查硬件
 *   talken-validator stake             - 质押 TALKEN 并注册
 *   talken-validator request-unstake   - 申请解除质押（进入 7 天解绑期）
 *   talken-validator claim-unstake     - 解绑期结束后提取 TALKEN
 *   talken-validator stake-status      - 查看质押状态
 */

import { loadConfig, saveConfig, resolveEnvVars, type ValidatorConfig } from "./config.js";
import { checkHardware, formatHardwareReport } from "./hardware-check.js";
import { NodeManager } from "./node-manager.js";
import { stakeAndRegister, requestUnstake, claimUnstake, checkStakeStatus } from "./staking.js";
import { encryptKey, decryptKey, hasKeyring } from "./keyring.js";
import { createInterface } from "readline";

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
    case "request-unstake":
      await cmdRequestUnstake();
      break;
    case "claim-unstake":
      await cmdClaimUnstake();
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

// ── Helpers ─────────────────────────────────────────────────────

function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getPrivateKeyForAuth(): Promise<string> {
  if (!hasKeyring()) {
    console.error("未找到加密密钥。请先运行 `talken-validator stake` 完成质押。");
    process.exit(1);
  }
  const password = await promptPassword("输入密钥密码: ");
  try {
    return decryptKey(password);
  } catch {
    console.error("密码错误。");
    process.exit(1);
  }
}

// ── Commands ─────────────────────────────────────────────────────

function cmdHelp(): void {
  console.log(`
TALKEN Validator Node

命令:
  init              初始化配置文件 (validator-config.yaml)
  start             启动验证节点（需要输入密码解密私钥）
  status            查看节点状态
  check             检查硬件是否满足要求
  stake             质押 TALKEN 并注册为中继节点
  request-unstake   申请解除质押（进入 7 天解绑期）
  claim-unstake     解绑期结束后提取 TALKEN
  stake-status      查看质押状态
  help              显示帮助信息

质押规则:
  - 质押后需等待 7 天才能申请解除质押
  - 申请解除后需再等待 7 天才能提取 TALKEN
  - 总锁定期约 14 天

示例:
  talken-validator init
  talken-validator check
  talken-validator stake              # 首次运行会要求输入私钥并加密存储
  talken-validator start              # 输入密码解密私钥后启动
  talken-validator request-unstake    # 申请解除质押
  talken-validator claim-unstake      # 7 天后提取
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

  if (process.env.TALKEN_URL) config.network.server_url = process.env.TALKEN_URL;
  if (process.env.TALKEN_AGENT_ID) config.node.name = process.env.TALKEN_AGENT_ID;

  saveConfig(config, configPath);
  console.log(`配置文件已生成: ${configPath}`);
  console.log("请编辑配置文件，填入 LLM 端点和 API Key。");
  console.log(`\n当前配置:`);
  console.log(`  节点名称: ${config.node.name}`);
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

  // Check keyring
  if (!hasKeyring()) {
    console.error("\n错误: 未找到加密密钥。请先运行 `talken-validator stake` 完成质押。");
    process.exit(1);
  }

  // Prompt for password to decrypt private key
  console.log("");
  const password = await promptPassword("输入密钥密码: ");
  let privateKey: string;
  try {
    privateKey = decryptKey(password);
  } catch {
    console.error("\n密码错误或密钥文件损坏。");
    process.exit(1);
  }

  // Start node
  const manager = new NodeManager(resolved, privateKey);

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
    process.exit(1);
  }
}

async function cmdStake(): Promise<void> {
  let privateKey: string;

  if (hasKeyring()) {
    console.log("检测到已有密钥。");
    const password = await promptPassword("输入密钥密码: ");
    try {
      privateKey = decryptKey(password);
    } catch {
      console.error("密码错误。");
      process.exit(1);
    }
  } else {
    console.log("首次质押，需要设置钱包私钥。");
    console.log("私钥将使用 AES-256 加密存储在 ~/.talken/key.enc\n");
    privateKey = await promptInput("钱包私钥 (0x...): ");
    if (!privateKey) {
      console.error("私钥不能为空。");
      process.exit(1);
    }

    const password = await promptPassword("设置加密密码: ");
    const password2 = await promptPassword("确认加密密码: ");
    if (password !== password2) {
      console.error("两次密码不一致。");
      process.exit(1);
    }

    encryptKey(privateKey, password);
    console.log("私钥已加密存储。");
  }

  // Get relay URL
  const config = loadConfig();
  const port = config.network.listen_port || 1789;
  const defaultUrl = config.network.server_url || `ws://0.0.0.0:${port}`;

  console.log(`\n默认中继地址: ${defaultUrl}`);
  const customUrl = await promptInput(`中继地址 [${defaultUrl}]: `);
  const relayUrl = customUrl || defaultUrl;

  try {
    console.log("\n=== TALKEN 中继节点质押 ===\n");
    const result = await stakeAndRegister(privateKey, relayUrl);
    if (result.success) {
      console.log(`\n质押成功！TX: ${result.txHash}`);
      console.log("你的节点已被注册到链上，其他 Agent 可以通过 RelayRegistry 发现你的节点。");
      console.log("\n注意: 质押后 7 天内无法解除质押。");
      console.log("\n现在可以运行 `talken-validator start` 启动节点。");
    } else {
      console.error(`\n质押失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n质押失败: ${err.message}`);
    process.exit(1);
  }
}

async function cmdRequestUnstake(): Promise<void> {
  const privateKey = await getPrivateKeyForAuth();

  try {
    console.log("\n=== 申请解除质押 ===\n");
    console.log("注意: 申请后需等待 7 天解绑期才能提取 TALKEN。");
    console.log("解绑期间节点仍在线，但不应接收新任务。\n");

    const confirm = await promptInput("确认申请解除质押？(y/N): ");
    if (confirm !== "y" && confirm !== "Y") {
      console.log("已取消。");
      return;
    }

    const result = await requestUnstake(privateKey);
    if (result.success) {
      console.log(`\n申请成功！TX: ${result.txHash}`);
      console.log("7 天后运行 `talken-validator claim-unstake` 提取 TALKEN。");
    } else {
      console.error(`\n失败: ${result.error}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n失败: ${err.message}`);
    process.exit(1);
  }
}

async function cmdClaimUnstake(): Promise<void> {
  const privateKey = await getPrivateKeyForAuth();

  try {
    console.log("\n=== 提取质押 ===\n");
    const result = await claimUnstake(privateKey);
    if (result.success) {
      console.log(`\n提取成功！TX: ${result.txHash}`);
      console.log("100 TALKEN 已退还到你的钱包。");
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
  const address = args[args.indexOf("--address") + 1];

  if (!address && !hasKeyring()) {
    console.error("请使用 --address 指定地址，或先运行 stake 命令。");
    process.exit(1);
  }

  let addr = address;
  if (!addr) {
    const password = await promptPassword("输入密钥密码: ");
    try {
      const { privateKeyToAccount } = await import("viem/accounts");
      const key = decryptKey(password);
      const k = key.startsWith("0x") ? key : `0x${key}`;
      addr = privateKeyToAccount(k as `0x${string}`).address;
    } catch {
      console.error("密码错误。");
      process.exit(1);
    }
  }

  try {
    const status = await checkStakeStatus(addr!);
    console.log("\n=== 质押状态 ===\n");
    console.log(`地址:       ${addr}`);
    console.log(`已质押:     ${status.staked ? "是" : "否"}`);
    console.log(`解绑中:     ${status.unbonding ? "是" : "否"}`);
    console.log(`TALKEN:     ${status.balance}`);
    if (status.stakeAge) console.log(`质押时长:   ${status.stakeAge}`);
    if (status.unstakeAfter) console.log(`解绑状态:   ${status.unstakeAfter}`);
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

// ── Run ──────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
