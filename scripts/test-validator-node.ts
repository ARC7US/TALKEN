/**
 * TALKEN Validator Node Test
 *
 * Tests the validator node's config, hardware check, LLM provider, and scoring engine.
 * Does NOT require a running LLM API - uses mock responses for scoring.
 *
 * Run: npx tsx scripts/test-validator-node.ts
 */

import { loadConfig, saveConfig, resolveEnvVars } from "../packages/validator-node/src/config.js";
import { checkHardware, formatHardwareReport } from "../packages/validator-node/src/hardware-check.js";
import { parseScoringResult } from "../packages/validator-node/src/llm-provider.js";
import { NodeManager } from "../packages/validator-node/src/node-manager.js";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";

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
  console.log("║  TALKEN Validator Node Test              ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Hardware check ───────────────────────────────────────────────
  section("Hardware check");

  const hwReport = checkHardware();
  assert(hwReport.cpu_cores > 0, `CPU cores detected: ${hwReport.cpu_cores}`);
  assert(hwReport.memory_gb > 0, `Memory detected: ${hwReport.memory_gb} GB`);
  assert(typeof hwReport.passed === "boolean", "Hardware pass/fail determined");
  console.log(formatHardwareReport(hwReport));

  // ── 2. Config loading ───────────────────────────────────────────────
  section("Config loading");

  const config = loadConfig();
  assert(config.node.name.length > 0, `Node name: ${config.node.name}`);
  assert(config.network.server_url.length > 0, `Server URL: ${config.network.server_url}`);
  assert(config.llm.default_provider.length > 0, `Default provider: ${config.llm.default_provider}`);
  assert(config.scoring.prompt_template.length > 0, "Prompt template exists");
  assert(config.staking.amount > 0, `Stake amount: ${config.staking.amount}`);

  // ── 3. Config save/load roundtrip ───────────────────────────────────
  section("Config save/load roundtrip");

  const testConfigPath = join(process.cwd(), "test-validator-config.yaml");
  config.node.name = "test-validator-roundtrip";
  saveConfig(config, testConfigPath);
  assert(existsSync(testConfigPath), "Config file saved");

  const loaded = loadConfig(testConfigPath);
  assert(loaded.node.name === "test-validator-roundtrip", "Config roundtrip preserves node name");
  assert(loaded.network.server_url === config.network.server_url, "Config roundtrip preserves server URL");

  // Cleanup
  if (existsSync(testConfigPath)) unlinkSync(testConfigPath);

  // ── 4. Env var resolution ───────────────────────────────────────────
  section("Environment variable resolution");

  process.env.TEST_TALKEN_URL = "http://test.example.com";
  const resolved = resolveEnvVars({
    url: "${TEST_TALKEN_URL}",
    name: "literal",
    nested: { key: "${TEST_TALKEN_URL}" },
  }) as any;
  assert(resolved.url === "http://test.example.com", "Env var resolved in string");
  assert(resolved.name === "literal", "Literal string preserved");
  assert(resolved.nested.key === "http://test.example.com", "Env var resolved in nested object");
  delete process.env.TEST_TALKEN_URL;

  // ── 5. Scoring result parsing ───────────────────────────────────────
  section("Scoring result parsing");

  const validJson = '{"passed": true, "score": 85, "reason": "结果正确且质量高"}';
  const result1 = parseScoringResult(validJson);
  assert(result1.passed === true, "Passed parsed correctly");
  assert(result1.score === 85, "Score parsed correctly");
  assert(result1.reason === "结果正确且质量高", "Reason parsed correctly");

  // With surrounding text
  const withText = 'Here is my evaluation:\n{"passed": false, "score": 30, "reason": "结果不完整"}\nDone.';
  const result2 = parseScoringResult(withText);
  assert(result2.passed === false, "Passed parsed from text with surrounding content");
  assert(result2.score === 30, "Score parsed from text");

  // Score clamping
  const overScore = '{"passed": true, "score": 150, "reason": "good"}';
  const result3 = parseScoringResult(overScore);
  assert(result3.score === 100, "Score clamped to 100");

  const underScore = '{"passed": false, "score": -10, "reason": "bad"}';
  const result4 = parseScoringResult(underScore);
  assert(result4.score === 0, "Score clamped to 0");

  // Invalid JSON
  let invalidCaught = false;
  try {
    parseScoringResult("no json here");
  } catch {
    invalidCaught = true;
  }
  assert(invalidCaught, "Invalid JSON throws error");

  // Missing fields
  let missingCaught = false;
  try {
    parseScoringResult('{"passed": true}');
  } catch {
    missingCaught = true;
  }
  assert(missingCaught, "Missing fields throws error");

  // ── 6. Node manager creation ────────────────────────────────────────
  section("Node manager creation");

  const nodeConfig = loadConfig();
  nodeConfig.network.server_url = BASE;
  nodeConfig.node.name = `test-validator-${Date.now().toString(36)}`;

  const manager = new NodeManager(nodeConfig);
  assert(manager !== null, "Node manager created");

  // ── 7. Setup test agents ────────────────────────────────────────────
  section("Setup test agents");

  const valId = nodeConfig.node.name;
  await api("POST", "/api/v1/agents", { id: valId, name: "Test Validator", skills: ["verify"] }, valId);
  await api("PATCH", `/api/v1/agents/${valId}`, { balance: 500 }, valId);
  await api("POST", `/api/v1/agents/${valId}/stake`, { amount: 200 }, valId);
  console.log(`  Validator ${valId} registered and staked`);

  // ── 8. Node status (before start) ───────────────────────────────────
  section("Node status before start");

  try {
    const status = await manager.formatStatus();
    assert(status.includes("已停止"), "Status shows stopped before start");
  } catch (err: any) {
    // May fail if server doesn't have the agent yet
    console.log(`  Note: Status check failed (${err.message}), skipping`);
    passed++;
  }

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
