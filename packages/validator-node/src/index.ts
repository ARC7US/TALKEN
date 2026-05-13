#!/usr/bin/env node

/**
 * TALKEN Validator Node CLI
 *
 * Usage:
 *   talken-validator init              - 初始化配置
 *   talken-validator start             - 启动节点（后台守护进程）
 *   talken-validator stop              - 停止守护进程
 *   talken-validator status            - 查看状态
 *   talken-validator logs              - 查看日志
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
import { spawn } from "child_process";
import { homedir } from "os";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  createWriteStream,
  watch,
  statSync,
} from "fs";
import { join } from "path";
import { format } from "util";

const args = process.argv.slice(2);
const command = args[0] ?? "help";
// Only check --foreground for the start command (avoid -f conflict with logs --follow)
const foreground = command === "start" && (args.includes("--foreground") || args.includes("-f"));

const TALKEN_DIR = join(homedir(), ".talken");
const PID_FILE = join(TALKEN_DIR, "validator.pid");
const LOG_FILE = join(TALKEN_DIR, "validator.log");

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  // Check if this is a daemon child process
  const daemonKey = process.env._TALKEN_DAEMON_KEY;
  if (process.env._TALKEN_DAEMON === "1" && daemonKey) {
    await runDaemon(daemonKey);
    return;
  }

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "start":
      await cmdStart();
      break;
    case "stop":
      await cmdStop();
      break;
    case "status":
      await cmdStatus();
      break;
    case "logs":
      await cmdLogs();
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

// ── Daemon ───────────────────────────────────────────────────────

function daemonize(privateKey: string): void {
  const child = spawn(process.execPath, process.argv.slice(1), {
    env: { ...process.env, _TALKEN_DAEMON: "1", _TALKEN_DAEMON_KEY: privateKey },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  console.log(`守护进程已启动 (PID: ${child.pid})`);
  console.log(`日志文件: ${LOG_FILE}`);
  console.log(`停止节点: talken-validator stop`);
}

function setupDaemon(): void {
  process.stdin.destroy();
  try {
    const logStream = createWriteStream(LOG_FILE, { flags: "a" });
    const writer = (chunk: any) => {
      try { logStream.write(typeof chunk === "string" ? chunk : String(chunk)); } catch {}
    };
    console.log = (...args: any[]) => writer(format(...args) + "\n");
    console.error = (...args: any[]) => writer(format(...args) + "\n");
    console.warn = (...args: any[]) => writer(format(...args) + "\n");
    console.info = (...args: any[]) => writer(format(...args) + "\n");
    process.stdout.write = writer as any;
    process.stderr.write = writer as any;
    writeFileSync(PID_FILE, String(process.pid));
  } catch {
    // If we can't set up logging, continue anyway (daemon still runs)
  }
}

async function runDaemon(privateKey: string): Promise<void> {
  // Clear the key from env immediately after reading
  delete process.env._TALKEN_DAEMON_KEY;
  delete process.env._TALKEN_DAEMON;

  setupDaemon();

  const config = loadConfig();
  const resolved = resolveEnvVars(config) as ValidatorConfig;

  const manager = new NodeManager(resolved, privateKey);

  process.on("SIGINT", () => {
    manager.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    manager.stop();
    process.exit(0);
  });

  try {
    await manager.init();
    await manager.start();
    await new Promise(() => {});
  } catch (err: any) {
    console.error(`启动失败: ${err.message}`);
    process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────

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

// ── Commands ──────────────────────────────────────────────────────

function cmdHelp(): void {
  console.log(`
TALKEN Validator Node

命令:
  init              初始化配置文件 (validator-config.yaml)
  start             启动验证节点（后台守护进程，输入密码后自动转入后台）
  stop              停止守护进程
  status            查看节点状态
  logs              查看节点日志
  check             检查硬件是否满足要求
  stake             质押 TALKEN 并注册为中继节点
  request-unstake   申请解除质押（进入 7 天解绑期）
  claim-unstake     解绑期结束后提取 TALKEN
  stake-status      查看质押状态
  help              显示帮助信息

start 选项:
  --foreground, -f   前台运行（调试用，Ctrl+C 停止）

logs 选项:
  --lines N, -n N    显示最后 N 行（默认 50）
  --follow, -f       持续跟踪日志（tail -f 模式）

质押规则:
  - 质押后需等待 7 天才能申请解除质押
  - 申请解除后需再等待 7 天才能提取 TALKEN
  - 总锁定期约 14 天

示例:
  talken-validator init
  talken-validator check
  talken-validator stake                 # 首次运行会要求输入私钥并加密存储
  talken-validator start                 # 输入密码解密私钥后自动在后台启动
  talken-validator status                # 查看节点状态
  talken-validator logs --lines 20       # 查看最近 20 行日志
  talken-validator logs -f               # 实时查看日志
  talken-validator stop                  # 停止节点
  talken-validator start --foreground    # 前台调试模式
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

  // Foreground mode (debug)
  if (foreground) {
    console.log("\n前台模式启动（Ctrl+C 停止）...\n");
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

  // Daemon mode (default): fork to background
  daemonize(privateKey);
}

async function cmdStop(): Promise<void> {
  if (!existsSync(PID_FILE)) {
    console.log("没有正在运行的守护进程（PID 文件不存在）。");
    return;
  }

  const pidStr = readFileSync(PID_FILE, "utf-8").trim();
  const pid = parseInt(pidStr, 10);

  if (!pid || isNaN(pid)) {
    console.error("PID 文件损坏。");
    unlinkSync(PID_FILE);
    return;
  }

  // Check if process exists
  try {
    process.kill(pid, 0);
  } catch {
    console.log(`进程 ${pid} 已不在运行。`);
    try { unlinkSync(PID_FILE); } catch {}
    return;
  }

  console.log(`正在停止节点 (PID: ${pid})...`);
  process.kill(pid, "SIGTERM");

  // Wait up to 10s for graceful shutdown
  let stopped = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      process.kill(pid, 0);
    } catch {
      stopped = true;
      break;
    }
  }

  if (!stopped) {
    console.log("节点未响应 SIGTERM，发送 SIGKILL...");
    try { process.kill(pid, "SIGKILL"); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  try { unlinkSync(PID_FILE); } catch {}
  console.log("节点已停止。");
}

async function cmdStatus(): Promise<void> {
  // Check PID file
  let pidRunning = false;
  let pid: number | null = null;

  if (existsSync(PID_FILE)) {
    const pidStr = readFileSync(PID_FILE, "utf-8").trim();
    pid = parseInt(pidStr, 10);
    if (pid && !isNaN(pid)) {
      try {
        process.kill(pid, 0);
        pidRunning = true;
      } catch {}
    }
  }

  console.log("\n=== 节点状态 ===");
  console.log(`守护进程:   ${pidRunning ? `运行中 (PID: ${pid})` : "未运行"}`);
  console.log(`PID 文件:   ${PID_FILE}`);
  console.log(`日志文件:   ${LOG_FILE}`);

  if (pidRunning && pid) {
    // Try health endpoint
    const config = loadConfig();
    const port = config.network.listen_port || 1789;
    try {
      const resp = await fetch(`http://localhost:${port}/health`);
      if (resp.ok) {
        const data = await resp.json() as any;
        console.log(`端口:       ${port} (可达)`);
        if (data.uptime) console.log(`运行时间:   ${Math.floor(data.uptime / 60)} 分钟`);
      }
    } catch {
      console.log(`端口:       ${port} (无法连接)`);
    }
  }
  console.log("");
}

async function cmdLogs(): Promise<void> {
  if (!existsSync(LOG_FILE)) {
    console.log("日志文件不存在，节点可能尚未启动。");
    return;
  }

  const followIdx = args.indexOf("--follow");
  const follow = followIdx !== -1 || args.includes("-f");

  const linesIdx = args.indexOf("--lines");
  const nIdx = args.indexOf("-n");
  const lineIdx = linesIdx !== -1 ? linesIdx : nIdx !== -1 ? nIdx : -1;
  const numLines = lineIdx !== -1 ? parseInt(args[lineIdx + 1], 10) || 50 : 50;

  if (follow) {
    // Tail -f mode
    console.log(`跟踪日志: ${LOG_FILE} (Ctrl+C 退出)`);
    let lastSize = statSync(LOG_FILE).size;
    // Print last N lines first
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n");
    const startIdx = Math.max(0, lines.length - numLines - 1);
    process.stdout.write(lines.slice(startIdx).join("\n"));

    const watcher = watch(LOG_FILE, () => {
      try {
        const newSize = statSync(LOG_FILE).size;
        if (newSize > lastSize) {
          const stream = readFileSync(LOG_FILE, "utf-8").slice(lastSize);
          process.stdout.write(stream);
          lastSize = newSize;
        }
      } catch {}
    });

    process.on("SIGINT", () => { watcher.close(); process.exit(0); });
    process.on("SIGTERM", () => { watcher.close(); process.exit(0); });
    await new Promise(() => {});
  } else {
    // Print last N lines
    const content = readFileSync(LOG_FILE, "utf-8");
    const lines = content.split("\n");
    const startIdx = Math.max(0, lines.length - numLines);
    console.log(lines.slice(startIdx).join("\n"));
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

// ── Run ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
