/**
 * Standalone MCP Server Test
 * Tests the MCP plugin as an independent process via stdio.
 *
 * Run: npx tsx scripts/test-mcp-standalone.ts
 */

import { spawn, type ChildProcess } from "child_process";
import { join } from "path";

const PROJECT_ROOT = join(import.meta.dirname, "..");
const MCP_SERVER = join(PROJECT_ROOT, "packages/plugin-mcp/src/index.ts");

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (!condition) {
    failed++;
    console.error(`  ✗ ${message}`);
  } else {
    passed++;
    console.log(`  ✓ ${message}`);
  }
}

function sendMcp(proc: ChildProcess, obj: any): void {
  const data = JSON.stringify(obj);
  const msg = `Content-Length: ${Buffer.byteLength(data)}\r\n\r\n${data}`;
  proc.stdin!.write(msg);
}

function parseMcpMessages(raw: string): any[] {
  const messages: any[] = [];
  let buf = raw;
  while (buf.length > 0) {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) break;
    const header = buf.substring(0, idx);
    const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lenMatch) break;
    const len = parseInt(lenMatch[1], 10);
    const body = buf.substring(idx + 4, idx + 4 + len);
    try {
      messages.push(JSON.parse(body));
    } catch { /* skip invalid */ }
    buf = buf.substring(idx + 4 + len);
  }
  return messages;
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TALKEN MCP Standalone Test              ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Start MCP server process ──────────────────────────────────────
  console.log("\n┌─ 1. Start MCP server process");

  const proc = spawn("npx", ["tsx", MCP_SERVER], {
    cwd: PROJECT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TALKEN_URL: "http://localhost:3001",
      TALKEN_AGENT_ID: "mcp-standalone-test",
      TALKEN_SKILLS: "search,code",
    },
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d) => { stdout += d.toString(); });
  proc.stderr.on("data", (d) => { stderr += d.toString(); });

  const waitForResponse = () => new Promise<void>((resolve) => {
    const check = () => {
      if (stdout.includes("\r\n\r\n")) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });

  try {
    // ── 2. Initialize ──────────────────────────────────────────────────
    console.log("\n┌─ 2. Initialize");

    sendMcp(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0" },
      },
    });

    await waitForResponse();
    const initMsgs = parseMcpMessages(stdout);
    const initResp = initMsgs.find((m) => m.id === 1);
    assert(initResp !== undefined, "Got initialize response");
    assert(initResp?.result?.serverInfo?.name === "talken-mcp", "Server name is talken-mcp");
    assert(initResp?.result?.protocolVersion === "2024-11-05", "Protocol version matches");
    console.log(`  Server: ${initResp?.result?.serverInfo?.name} v${initResp?.result?.serverInfo?.version}`);

    // ── 3. List tools ──────────────────────────────────────────────────
    console.log("\n┌─ 3. List tools");

    stdout = "";
    sendMcp(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

    await waitForResponse();
    const listMsgs = parseMcpMessages(stdout);
    const listResp = listMsgs.find((m) => m.id === 2);
    assert(listResp !== undefined, "Got tools/list response");

    const tools = listResp?.result?.tools ?? [];
    assert(tools.length >= 8, `Got ${tools.length} tools (expected >= 8)`);

    const toolNames = tools.map((t: any) => t.name);
    assert(toolNames.includes("talken_switch_role"), "Has talken_switch_role");
    assert(toolNames.includes("talken_publish_task"), "Has talken_publish_task");
    assert(toolNames.includes("talken_check_balance"), "Has talken_check_balance");
    assert(toolNames.includes("talken_vote"), "Has talken_vote");
    console.log(`  Tools: ${toolNames.join(", ")}`);

    // ── 4. Call tool: check balance ────────────────────────────────────
    console.log("\n┌─ 4. Call tool: talken_check_balance");

    stdout = "";
    sendMcp(proc, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "talken_check_balance",
        arguments: {},
      },
    });

    await waitForResponse();
    const callMsgs = parseMcpMessages(stdout);
    const callResp = callMsgs.find((m) => m.id === 3);
    assert(callResp !== undefined, "Got tools/call response");
    const content = callResp?.result?.content?.[0]?.text ?? "";
    assert(content.length > 0, "Response has content");
    console.log(`  Response: ${content.substring(0, 80)}...`);

    // ── 5. Call tool: switch role ───────────────────────────────────────
    console.log("\n┌─ 5. Call tool: talken_switch_role");

    stdout = "";
    sendMcp(proc, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "talken_switch_role",
        arguments: { role: "executor" },
      },
    });

    await waitForResponse();
    const switchMsgs = parseMcpMessages(stdout);
    const switchResp = switchMsgs.find((m) => m.id === 4);
    assert(switchResp !== undefined, "Got switch_role response");
    const switchContent = switchResp?.result?.content?.[0]?.text ?? "";
    assert(switchContent.includes("executor"), "Response mentions executor");
    console.log(`  Response: ${switchContent}`);

    // ── 6. Unknown tool error ──────────────────────────────────────────
    console.log("\n┌─ 6. Error handling");

    stdout = "";
    sendMcp(proc, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "nonexistent_tool",
        arguments: {},
      },
    });

    await waitForResponse();
    const errMsgs = parseMcpMessages(stdout);
    const errResp = errMsgs.find((m) => m.id === 5);
    assert(errResp?.error !== undefined || errResp?.result?.content?.[0]?.text?.includes("未知"), "Unknown tool returns error");

  } finally {
    proc.kill();
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed${" ".repeat(Math.max(0, 16 - String(passed).length - String(failed).length))}║`);
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
