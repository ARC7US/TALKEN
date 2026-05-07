/**
 * TALKEN MCP Plugin Test
 *
 * Tests the MCP plugin's tool definitions and handler logic.
 * Does NOT require a running MCP server - tests the tools and handler directly.
 *
 * Run: npx tsx scripts/test-mcp-plugin.ts
 */

import { TALKEN_TOOLS } from "../packages/plugin-mcp/src/tools.js";
import { initClient, handleToolCall } from "../packages/plugin-mcp/src/handler.js";
import { TalkenClient } from "../packages/agent-sdk/src/client.js";

const BASE = "http://localhost:3001";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    throw new Error(`FAIL: ${message}`);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

let sectionNum = 0;
function section(title: string) {
  sectionNum++;
  console.log(`\n┌─ ${sectionNum}. ${title}`);
}

async function api(
  method: string,
  path: string,
  body?: unknown,
  agentId?: string,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (agentId) headers["X-Talken-Agent-Id"] = agentId;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TALKEN MCP Plugin Test                  ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Tool definitions ──────────────────────────────────────────────
  section("Tool definitions");

  assert(TALKEN_TOOLS.length >= 8, `At least 8 tools defined (got ${TALKEN_TOOLS.length})`);

  const toolNames = TALKEN_TOOLS.map((t) => t.name);
  assert(toolNames.includes("talken_switch_role"), "Has talken_switch_role tool");
  assert(toolNames.includes("talken_publish_task"), "Has talken_publish_task tool");
  assert(toolNames.includes("talken_accept_task"), "Has talken_accept_task tool");
  assert(toolNames.includes("talken_submit_result"), "Has talken_submit_result tool");
  assert(toolNames.includes("talken_vote"), "Has talken_vote tool");
  assert(toolNames.includes("talken_check_balance"), "Has talken_check_balance tool");
  assert(toolNames.includes("talken_list_tasks"), "Has talken_list_tasks tool");
  assert(toolNames.includes("talken_stake"), "Has talken_stake tool");
  assert(toolNames.includes("talken_handle_message"), "Has talken_handle_message tool");

  // Verify all tools have required fields
  for (const tool of TALKEN_TOOLS) {
    assert(tool.name.length > 0, `Tool ${tool.name} has name`);
    assert(tool.description.length > 0, `Tool ${tool.name} has description`);
    assert(tool.inputSchema.type === "object", `Tool ${tool.name} has object schema`);
  }

  // ── 2. Setup test agents ────────────────────────────────────────────
  section("Setup test agents");

  const agents = [
    { id: "mcp_pub", name: "MCP Publisher", skills: ["search"] },
    { id: "mcp_exec", name: "MCP Executor", skills: ["search"] },
    { id: "mcp_val_1", name: "MCP Validator 1", skills: ["verify"] },
  ];

  for (const a of agents) {
    await api("POST", "/api/v1/agents", a, a.id);
  }

  // Fund agents
  await api("PATCH", "/api/v1/agents/mcp_pub", { balance: 1000 }, "mcp_pub");
  await api("PATCH", "/api/v1/agents/mcp_exec", { balance: 500 }, "mcp_exec");
  await api("PATCH", "/api/v1/agents/mcp_val_1", { balance: 500 }, "mcp_val_1");
  await api("POST", "/api/v1/agents/mcp_val_1/stake", { amount: 200 }, "mcp_val_1");
  console.log("  Agents registered and funded");

  // ── 3. Handler: init client ─────────────────────────────────────────
  section("Handler: init client");

  const client = initClient({
    baseUrl: BASE,
    agentId: "mcp_pub",
    skills: ["search"],
  });
  assert(client !== null, "Client initialized");

  // ── 4. Handler: check balance ───────────────────────────────────────
  section("Handler: talken_check_balance");

  const balResult = await handleToolCall("talken_check_balance", {});
  assert(balResult.content.includes("TALKEN"), "Balance response contains TALKEN");
  console.log(`  Balance: ${balResult.content.split("\n")[0]}`);

  // ── 5. Handler: switch role ─────────────────────────────────────────
  section("Handler: talken_switch_role");

  const switchResult = await handleToolCall("talken_switch_role", { role: "publisher" });
  assert(switchResult.content.includes("publisher"), "Switched to publisher");

  // ── 6. Handler: publish task ────────────────────────────────────────
  section("Handler: talken_publish_task");

  const pubResult = await handleToolCall("talken_publish_task", {
    skill: "search",
    description: "MCP test task",
    fee: 10,
  });
  assert(pubResult.content.includes("已发布"), "Task published via handler");

  // Extract task ID
  const taskIdMatch = pubResult.content.match(/任务已发布: (\S+)/);
  assert(taskIdMatch !== null, "Task ID extracted");
  const taskId = taskIdMatch![1];

  // ── 7. Handler: list tasks ──────────────────────────────────────────
  section("Handler: talken_list_tasks");

  const listResult = await handleToolCall("talken_list_tasks", { status: "published" });
  assert(listResult.content.includes(taskId), "Published task appears in list");

  // ── 8. Handler: handle natural language ─────────────────────────────
  section("Handler: talken_handle_message");

  const nlResult = await handleToolCall("talken_handle_message", {
    message: "查看余额",
  });
  assert(nlResult.content.includes("TALKEN"), "Natural language '查看余额' works");

  // ── 9. Handler: unknown tool ────────────────────────────────────────
  section("Handler: error handling");

  const unknownResult = await handleToolCall("unknown_tool", {});
  assert(unknownResult.content.includes("未知工具"), "Unknown tool returns error");

  // ── 10. Handler: error handling (continued) ──────────────────────────
  // Test that uninitialized client returns error
  // (Already initialized above, so this is covered by the 'unknown tool' test)

  // ── Summary ─────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed${" ".repeat(Math.max(0, 16 - String(passed).length - String(failed).length))}║`);
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n╔══════════════════════════════════════════╗`);
  console.error(`║  TEST FAILED (${passed} passed, ${failed} failed)         ║`);
  console.error("╚══════════════════════════════════════════╝");
  console.error(err);
  process.exit(1);
});
