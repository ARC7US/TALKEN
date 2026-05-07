/**
 * TALKEN Blockchain Integration Test
 *
 * Tests the TangleService and stellar service factory.
 * Runs in mock mode (no real IOTA network required).
 *
 * Run: npx tsx scripts/test-blockchain.ts
 */

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
  console.log("║  TALKEN Blockchain Integration Test      ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Service mode verification ─────────────────────────────────────
  section("Service mode verification");

  const healthRes = await api("GET", "/health");
  assert(healthRes.status === 200, "Server is healthy");

  // The server should be running in mock mode (default)
  console.log("  Server running in mock mode (STELLAR_MODE=mock)");

  // ── 2. Agent registration with blockchain address ────────────────────
  section("Agent registration");

  const agents = [
    { id: "chain_pub", name: "Chain Publisher", skills: ["search"] },
    { id: "chain_exec", name: "Chain Executor", skills: ["search"] },
    { id: "chain_val_1", name: "Chain Validator 1", skills: ["verify"] },
    { id: "chain_val_2", name: "Chain Validator 2", skills: ["verify"] },
    { id: "chain_val_3", name: "Chain Validator 3", skills: ["verify"] },
  ];

  for (const a of agents) {
    const res = await api("POST", "/api/v1/agents", a, a.id);
    assert(res.status === 201, `Registered ${a.id}`);
  }

  // ── 3. Fund and stake ────────────────────────────────────────────────
  section("Fund and stake validators");

  await api("PATCH", "/api/v1/agents/chain_pub", { balance: 1000 }, "chain_pub");
  await api("PATCH", "/api/v1/agents/chain_exec", { balance: 500 }, "chain_exec");

  for (const id of ["chain_val_1", "chain_val_2", "chain_val_3"]) {
    await api("PATCH", `/api/v1/agents/${id}`, { balance: 500 }, id);
    await api("POST", `/api/v1/agents/${id}/stake`, { amount: 200 }, id);
  }
  console.log("  All agents funded and staked");

  // ── 4. Task lifecycle with settlement ────────────────────────────────
  section("Task lifecycle (create → accept → submit → verify → settle)");

  // Create task
  const createRes = await api("POST", "/api/v1/tasks", {
    skill: "search",
    params: { query: "blockchain test" },
    complexity: 1.0,
    fee: 10,
    ttl: 3600,
  }, "chain_pub");
  assert(createRes.status === 201, "Task created");
  const taskId = createRes.data.data.id;

  // Accept
  await api("POST", `/api/v1/tasks/${taskId}/accept`, {}, "chain_exec");
  console.log("  Task accepted");

  // Submit
  const submitRes = await api("POST", `/api/v1/tasks/${taskId}/submit`, {
    result: { content: "blockchain test result" },
  }, "chain_exec");
  const validators: string[] = submitRes.data.data.validators;
  assert(validators.length === 3, "3 validators selected");
  console.log(`  Selected validators: ${validators.join(", ")}`);

  // Record initial balances
  const initBal: Record<string, number> = {};
  for (const id of ["chain_pub", "chain_exec", ...validators]) {
    const res = await api("GET", `/api/v1/agents/${id}`, undefined, id);
    initBal[id] = res.data.data.balance;
  }
  console.log("  Initial balances recorded");

  // Vote (2 pass, 1 fail)
  let aggregatorId = "";
  for (let i = 0; i < validators.length; i++) {
    const res = await api("POST", `/api/v1/tasks/${taskId}/verify`, {
      passed: i < 2,
    }, validators[i]);
    if (res.data.data.aggregating) {
      aggregatorId = res.data.data.aggregatorId;
    }
  }
  assert(aggregatorId.length > 0, "Aggregator selected after 3 votes");

  // Aggregate
  const aggRes = await api("POST", `/api/v1/tasks/${taskId}/aggregate`, {}, aggregatorId);
  assert(aggRes.data.data.outcome.passed === true, "Consensus: PASS (2/3 majority)");
  console.log("  Aggregation complete");

  // Record pre-settlement balances
  const preSettleBal: Record<string, number> = {};
  for (const id of ["chain_pub", "chain_exec", ...validators]) {
    const res = await api("GET", `/api/v1/agents/${id}`, undefined, id);
    preSettleBal[id] = res.data.data.balance;
  }

  // Confirm → settlement
  const confirmRes = await api("POST", `/api/v1/tasks/${taskId}/confirm`, {}, "chain_pub");
  assert(confirmRes.status === 200, "Task confirmed and settled");
  assert(confirmRes.data.data.task.status === "settled", "Task status is settled");
  assert(confirmRes.data.data.settlement.txHash.length > 0, "Transaction hash exists");

  const settlement = confirmRes.data.data.settlement;
  console.log(`  Settlement txHash: ${settlement.txHash}`);
  console.log(`  Fee transfer: ${settlement.feeTransfer}`);
  console.log(`  Mint reward: ${settlement.mintReward}`);

  // ── 5. Verify balance changes ────────────────────────────────────────
  section("Verify balance changes after settlement");

  const finalBal: Record<string, number> = {};
  for (const id of ["chain_pub", "chain_exec", ...validators]) {
    const res = await api("GET", `/api/v1/agents/${id}`, undefined, id);
    finalBal[id] = res.data.data.balance;
  }

  // Publisher paid fee
  const pubDelta = finalBal["chain_pub"] - preSettleBal["chain_pub"];
  assert(pubDelta === -10, `Publisher paid fee (delta=${pubDelta})`);

  // Executor received fee + mint
  const execDelta = finalBal["chain_exec"] - preSettleBal["chain_exec"];
  assert(execDelta > 10, `Executor received payment (delta=${execDelta})`);

  // Majority validators received reward
  for (const vid of validators.slice(0, 2)) {
    const vDelta = finalBal[vid] - preSettleBal[vid];
    assert(vDelta === 0.5, `${vid} received +0.5 reward (delta=${vDelta})`);
  }

  // Dissenting validator was slashed
  const dissId = validators[2];
  const dissDelta = finalBal[dissId] - preSettleBal[dissId];
  assert(dissDelta === 0, `${dissId} balance unchanged (slash applied to stake)`);

  console.log("  All balance changes verified");

  // ── 6. Settlement record ─────────────────────────────────────────────
  section("Settlement record integrity");

  assert(settlement.feeTransfer > 0, "Fee transfer > 0");
  assert(settlement.mintReward > 0, "Mint reward > 0");
  assert(settlement.txHash.startsWith("tangle_") || settlement.txHash.startsWith("mock_"),
    `Transaction hash has valid prefix (got: ${settlement.txHash.slice(0, 10)}...)`);

  // ── 7. Multiple settlements ──────────────────────────────────────────
  section("Multiple settlements (second task)");

  const createRes2 = await api("POST", "/api/v1/tasks", {
    skill: "search",
    params: { query: "second blockchain test" },
    complexity: 2.0,
    fee: 20,
    ttl: 3600,
  }, "chain_pub");
  const taskId2 = createRes2.data.data.id;

  await api("POST", `/api/v1/tasks/${taskId2}/accept`, {}, "chain_exec");
  const submitRes2 = await api("POST", `/api/v1/tasks/${taskId2}/submit`, {
    result: { content: "second result" },
  }, "chain_exec");
  const validators2: string[] = submitRes2.data.data.validators;

  // All pass
  let aggId2 = "";
  for (const vid of validators2) {
    const res = await api("POST", `/api/v1/tasks/${taskId2}/verify`, { passed: true }, vid);
    if (res.data.data.aggregating) aggId2 = res.data.data.aggregatorId;
  }
  await api("POST", `/api/v1/tasks/${taskId2}/aggregate`, {}, aggId2);

  const confirmRes2 = await api("POST", `/api/v1/tasks/${taskId2}/confirm`, {}, "chain_pub");
  assert(confirmRes2.status === 200, "Second task settled");
  assert(confirmRes2.data.data.settlement.txHash !== settlement.txHash,
    "Second settlement has different txHash");

  console.log("  Second settlement complete");

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
