/**
 * TALKEN 3+1 Verification Test
 *
 * Tests the aggregation flow: 3 validators vote → 4th validator aggregates.
 *
 * Run: npx tsx scripts/test-3plus1.ts
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
  console.log("║  TALKEN 3+1 Verification Test            ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── Setup ─────────────────────────────────────────────────────────────
  section("Setup agents");

  const AGENTS = [
    { id: "agg_pub", name: "Agg Publisher", skills: ["search"] },
    { id: "agg_exec", name: "Agg Executor", skills: ["search"] },
    { id: "agg_v1", name: "Agg Validator 1", skills: ["verify"] },
    { id: "agg_v2", name: "Agg Validator 2", skills: ["verify"] },
    { id: "agg_v3", name: "Agg Validator 3", skills: ["verify"] },
    { id: "agg_v4", name: "Agg Validator 4", skills: ["verify"] },
    { id: "agg_v5", name: "Agg Validator 5", skills: ["verify"] },
    { id: "agg_outsider", name: "Outsider", skills: ["search"] },
  ];

  for (const a of AGENTS) {
    await api("POST", "/api/v1/agents", a, a.id);
  }

  // Fund and stake validators
  for (const id of ["agg_v1", "agg_v2", "agg_v3", "agg_v4", "agg_v5"]) {
    await api("PATCH", `/api/v1/agents/${id}`, { balance: 500 });
    await api("POST", `/api/v1/agents/${id}/stake`, { amount: 200 });
  }
  await api("PATCH", "/api/v1/agents/agg_pub", { balance: 1000 });
  await api("PATCH", "/api/v1/agents/agg_exec", { balance: 100 });

  console.log("  All agents registered, funded, staked");

  // ── 1. Create task and submit ─────────────────────────────────────────
  section("Create task and submit");

  const createRes = await api("POST", "/api/v1/tasks", {
    skill: "search",
    params: { query: "test 3+1" },
    complexity: 1.0,
    fee: 10,
    ttl: 3600,
  }, "agg_pub");

  assert(createRes.status === 201, "Task created");
  const taskId = createRes.data.data.id;

  await api("POST", `/api/v1/tasks/${taskId}/accept`, {}, "agg_exec");
  const submitRes = await api("POST", `/api/v1/tasks/${taskId}/submit`, { result: { content: "3+1 test result" } }, "agg_exec");
  assert(submitRes.status === 200, "Task submitted");

  const selectedValidators: string[] = submitRes.data.data.validators;
  console.log(`  Selected validators: ${selectedValidators.join(", ")}`);
  assert(selectedValidators.length === 3, "3 validators selected");

  // ── 2. Three validators vote ──────────────────────────────────────────
  section("Three validators vote");

  // Vote 1: PASS
  const vote1 = await api("POST", `/api/v1/tasks/${taskId}/verify`, { passed: true }, selectedValidators[0]);
  assert(vote1.status === 200, "Vote 1 cast (PASS)");
  assert(!vote1.data.data.aggregating, "Not aggregating after 1 vote");

  // Vote 2: PASS
  const vote2 = await api("POST", `/api/v1/tasks/${taskId}/verify`, { passed: true }, selectedValidators[1]);
  assert(vote2.status === 200, "Vote 2 cast (PASS)");
  assert(!vote2.data.data.aggregating, "Not aggregating after 2 votes");

  // Vote 3: FAIL
  const vote3 = await api("POST", `/api/v1/tasks/${taskId}/verify`, { passed: false }, selectedValidators[2]);
  assert(vote3.status === 200, "Vote 3 cast (FAIL)");

  // ── 3. Task enters aggregating state ──────────────────────────────────
  section("Aggregation phase starts");

  assert(vote3.data.data.aggregating === true, "Task enters aggregating after 3rd vote");
  assert(vote3.data.data.aggregatorId, "Aggregator ID returned");
  assert(vote3.data.data.blindVotes?.length === 3, "3 blind votes returned");

  const aggregatorId = vote3.data.data.aggregatorId;
  console.log(`  Aggregator: ${aggregatorId}`);

  // Verify task status
  const taskRes = await api("GET", `/api/v1/tasks/${taskId}`);
  assert(taskRes.data.data.status === "aggregating", "Task status is aggregating");

  // ── 4. Aggregator gets blind votes ────────────────────────────────────
  section("Blind votes privacy");

  const blindVotes = vote3.data.data.blindVotes;
  console.log(`  Blind votes: ${JSON.stringify(blindVotes)}`);

  // Verify blind IDs don't match original validator IDs
  for (const bv of blindVotes) {
    assert(!selectedValidators.includes(bv.blindId), `BlindId ${bv.blindId.slice(0, 8)}... is not a raw validator ID`);
  }

  // Verify pass/fail counts match (2 pass, 1 fail)
  const passCount = blindVotes.filter((v: any) => v.passed).length;
  const failCount = blindVotes.filter((v: any) => !v.passed).length;
  assert(passCount === 2, "2 PASS votes in blind votes");
  assert(failCount === 1, "1 FAIL vote in blind votes");

  // ── 5. Outsider cannot aggregate ──────────────────────────────────────
  section("Access control");

  const outsiderAgg = await api("POST", `/api/v1/tasks/${taskId}/aggregate`, {}, "agg_outsider");
  assert(outsiderAgg.status === 403, "Outsider cannot aggregate");

  // ── 6. Aggregator submits result ──────────────────────────────────────
  section("Aggregator tallies");

  const aggRes = await api("POST", `/api/v1/tasks/${taskId}/aggregate`, {}, aggregatorId);
  assert(aggRes.status === 200, "Aggregation submitted");
  assert(aggRes.data.data.outcome.passed === true, "Consensus: PASSED (2/3 majority)");
  assert(aggRes.data.data.outcome.qualityScore === 2 / 3, "Quality score = 2/3");
  assert(aggRes.data.data.outcome.voteSummary.passed === 2, "2 passes in summary");
  assert(aggRes.data.data.outcome.voteSummary.failed === 1, "1 fail in summary");

  // Task should now be verified
  const afterAgg = await api("GET", `/api/v1/tasks/${taskId}`);
  assert(afterAgg.data.data.status === "verified", "Task status is verified after aggregation");

  // ── 7. Publisher confirms → settlement ────────────────────────────────
  section("Settlement");

  const confirmRes = await api("POST", `/api/v1/tasks/${taskId}/confirm`, {}, "agg_pub");
  assert(confirmRes.status === 200, "Task confirmed and settled");
  assert(confirmRes.data.data.task.status === "settled", "Task status is settled");

  // ── 8. Test FAIL consensus ────────────────────────────────────────────
  section("FAIL consensus (2 fail + 1 pass)");

  // Create another task
  const createRes2 = await api("POST", "/api/v1/tasks", {
    skill: "search",
    params: { query: "fail test" },
    complexity: 1.0,
    fee: 5,
    ttl: 3600,
  }, "agg_pub");

  const taskId2 = createRes2.data.data.id;
  await api("POST", `/api/v1/tasks/${taskId2}/accept`, {}, "agg_exec");
  const submitRes2 = await api("POST", `/api/v1/tasks/${taskId2}/submit`, { result: { content: "fail test" } }, "agg_exec");
  const validators2: string[] = submitRes2.data.data.validators;

  // 2 fail + 1 pass
  await api("POST", `/api/v1/tasks/${taskId2}/verify`, { passed: false }, validators2[0]);
  await api("POST", `/api/v1/tasks/${taskId2}/verify`, { passed: false }, validators2[1]);
  const vote3b = await api("POST", `/api/v1/tasks/${taskId2}/verify`, { passed: true }, validators2[2]);

  const aggregatorId2 = vote3b.data.data.aggregatorId;
  const aggRes2 = await api("POST", `/api/v1/tasks/${taskId2}/aggregate`, {}, aggregatorId2);
  assert(aggRes2.data.data.outcome.passed === false, "Consensus: FAILED (2/3 majority)");
  assert(aggRes2.data.data.outcome.qualityScore === 1 / 3, "Quality score = 1/3");

  const afterAgg2 = await api("GET", `/api/v1/tasks/${taskId2}`);
  assert(afterAgg2.data.data.status === "rejected", "Task rejected after FAIL consensus");

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
