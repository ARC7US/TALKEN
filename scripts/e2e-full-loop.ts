/**
 * TALKEN E2E Full Loop Test
 *
 * Covers: register → stake → publish → accept → submit → 3+1 verify → settle
 * Plus: task listing, reject flow, task detail, settlement record
 *
 * Run: npx tsx scripts/e2e-full-loop.ts
 */

const BASE = "http://localhost:3001/api/v1";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FetchOptions {
  method?: string;
  agentId: string;
  body?: unknown;
}

let passed = 0;
let failed = 0;

async function api<T>(path: string, opts: FetchOptions): Promise<T> {
  const headers: Record<string, string> = {
    "X-Talken-Agent-Id": opts.agentId,
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${opts.method ?? "GET"} ${path}: ${JSON.stringify(json)}`,
    );
  }
  return json as T;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed++;
    throw new Error(`FAIL: ${message}`);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

function assertNear(actual: number, expected: number, message: string, tolerance = 0.001): void {
  assert(Math.abs(actual - expected) < tolerance, `${message} (expected ~${expected}, got ${actual})`);
}

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

const AGENTS = [
  { id: "publisher_1", name: "Publisher One", skills: ["search", "code"] },
  { id: "executor_1", name: "Executor One", skills: ["search", "code", "analyze"] },
  { id: "executor_2", name: "Executor Two", skills: ["search"] },
  { id: "validator_1", name: "Validator One", skills: ["verify"] },
  { id: "validator_2", name: "Validator Two", skills: ["verify"] },
  { id: "validator_3", name: "Validator Three", skills: ["verify"] },
];

// ---------------------------------------------------------------------------
// Section runner
// ---------------------------------------------------------------------------

let sectionNum = 0;
function section(title: string) {
  sectionNum++;
  console.log(`\n┌─ ${sectionNum}. ${title}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     TALKEN E2E Full Loop Test            ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Register agents ──────────────────────────────────────────────────
  section("Register agents");
  for (const agent of AGENTS) {
    await api("/agents", {
      method: "POST",
      agentId: agent.id,
      body: {
        id: agent.id,
        name: agent.name,
        skills: agent.skills,
        signature: "sig_" + agent.id,
      },
    });
    console.log(`  Registered ${agent.id} (${agent.name})`);
  }

  // ── 2. Fund & stake validators ──────────────────────────────────────────
  section("Fund & stake validators");
  // Ensure publisher has balance for fees
  const pubAgent = await api<{ data: { balance: number } }>(`/agents/publisher_1`, { agentId: "publisher_1" });
  if (pubAgent.data.balance < 100) {
    await api(`/agents/publisher_1`, {
      method: "PATCH",
      agentId: "publisher_1",
      body: { balance: 1000 },
    });
  }
  // Ensure validators have enough balance to stake
  for (const vid of ["validator_1", "validator_2", "validator_3"]) {
    const agent = await api<{ data: { balance: number } }>(`/agents/${vid}`, { agentId: vid });
    if (agent.data.balance < 200) {
      await api(`/agents/${vid}`, {
        method: "PATCH",
        agentId: vid,
        body: { balance: 500 },
      });
    }
  }
  for (const vid of ["validator_1", "validator_2", "validator_3"]) {
    const agent = await api<{ data: { stakeAmount: number } }>(`/agents/${vid}`, { agentId: vid });
    // Only stake if not already staked
    if (agent.data.stakeAmount < 200) {
      await api("/validators/stake", {
        method: "POST",
        agentId: vid,
        body: { amount: 200 },
      });
    }
    console.log(`  ${vid} ensured stake >= 200`);
  }

  // ── 3. Record initial balances ──────────────────────────────────────────
  section("Record initial balances");
  const initBal: Record<string, number> = {};
  const initStake: Record<string, number> = {};
  for (const agent of AGENTS) {
    const res = await api<{ data: { balance: number; stakeAmount: number } }>(
      `/agents/${agent.id}`,
      { agentId: agent.id },
    );
    initBal[agent.id] = res.data.balance;
    initStake[agent.id] = res.data.stakeAmount;
    console.log(`  ${agent.id}: bal=${res.data.balance}, stake=${res.data.stakeAmount}`);
  }

  // ── 4. Publisher creates task ───────────────────────────────────────────
  section("Publisher creates task");
  const taskRes = await api<{ data: { id: string } }>("/tasks", {
    method: "POST",
    agentId: "publisher_1",
    body: {
      skill: "search",
      params: { query: "e2e full loop test" },
      complexity: 1.5,
      fee: 10,
      ttl: 300,
    },
  });
  const taskId = taskRes.data.id;
  assert(taskId.length > 0, `Task created: ${taskId}`);

  // ── 5. Task listing & filtering ─────────────────────────────────────────
  section("Task listing & filtering");
  const allTasks = await api<{ data: unknown[] }>("/tasks", { agentId: "publisher_1" });
  assert(allTasks.data.length >= 1, `All tasks: ${allTasks.data.length} task(s)`);

  const pubTasks = await api<{ data: unknown[] }>(
    `/tasks?status=published&publisherId=publisher_1`,
    { agentId: "publisher_1" },
  );
  assert(pubTasks.data.length >= 1, `Publisher's published tasks: ${pubTasks.data.length}`);

  // ── 6. Task detail ──────────────────────────────────────────────────────
  section("Task detail");
  const taskDetail = await api<{
    data: {
      id: string;
      status: string;
      skill: string;
      fee: number;
      complexity: number;
      publisherId: string;
    };
  }>(`/tasks/${taskId}`, { agentId: "publisher_1" });
  assert(taskDetail.data.status === "published", `Task status is "published"`);
  assert(taskDetail.data.skill === "search", `Task skill is "search"`);
  assert(taskDetail.data.fee === 10, `Task fee is 10`);
  assert(taskDetail.data.publisherId === "publisher_1", `Publisher is "publisher_1"`);

  // ── 7. Executor accepts ─────────────────────────────────────────────────
  section("Executor accepts task");
  await api(`/tasks/${taskId}/accept`, {
    method: "POST",
    agentId: "executor_1",
  });
  const acceptedTask = await api<{ data: { status: string; executorId: string } }>(
    `/tasks/${taskId}`,
    { agentId: "executor_1" },
  );
  assert(acceptedTask.data.status === "accepted", `Task status is "accepted"`);
  assert(acceptedTask.data.executorId === "executor_1", `Executor is "executor_1"`);

  // ── 8. Executor submits result ──────────────────────────────────────────
  section("Executor submits result");
  const submitRes = await api<{
    data: { task: { id: string; status: string }; validators: string[] };
  }>(`/tasks/${taskId}/submit`, {
    method: "POST",
    agentId: "executor_1",
    body: { result: { content: "e2e test result content", tokensUsed: 42 } },
  });
  assert(submitRes.data.task.status === "submitted", `Task status is "submitted"`);
  assert(submitRes.data.validators.length === 3, `3 validators selected`);
  const selectedValidators = submitRes.data.validators;
  console.log(`  Selected validators: ${selectedValidators.join(", ")}`);

  // Record initial balances for the selected validators (they might not be in AGENTS)
  for (const vid of selectedValidators) {
    if (!(vid in initBal)) {
      const res = await api<{ data: { balance: number; stakeAmount: number } }>(
        `/agents/${vid}`,
        { agentId: vid },
      );
      initBal[vid] = res.data.balance;
      initStake[vid] = res.data.stakeAmount;
    }
  }

  // ── 9. 3+1 Verification (2 pass, 1 fail) ───────────────────────────────
  section("3+1 Verification (2 pass, 1 fail)");

  // First validator: PASS
  await api(`/tasks/${taskId}/verify`, {
    method: "POST",
    agentId: selectedValidators[0],
    body: { passed: true },
  });
  console.log(`  ${selectedValidators[0]}: PASS`);

  // Second validator: PASS
  await api(`/tasks/${taskId}/verify`, {
    method: "POST",
    agentId: selectedValidators[1],
    body: { passed: true },
  });
  console.log(`  ${selectedValidators[1]}: PASS`);

  // Third validator: FAIL → triggers aggregation phase
  const voteRes = await api<{
    data: { vote: unknown; outcome: null; aggregating: boolean; aggregatorId: string; blindVotes: Array<{ blindId: string; passed: boolean }> };
  }>(`/tasks/${taskId}/verify`, {
    method: "POST",
    agentId: selectedValidators[2],
    body: { passed: false },
  });
  console.log(`  ${selectedValidators[2]}: FAIL`);

  // After 3rd vote, task enters aggregating state
  assert(voteRes.data.aggregating === true, "Task enters aggregating after 3rd vote");
  assert(voteRes.data.aggregatorId, "Aggregator ID returned");
  const aggregatorId = voteRes.data.aggregatorId;
  console.log(`  Aggregator: ${aggregatorId}`);

  // Aggregator tallies blind votes
  const aggRes = await api<{
    data: { task: { status: string }; outcome: { passed: boolean; qualityScore: number; voteSummary: { passed: number; failed: number } } };
  }>(`/tasks/${taskId}/aggregate`, {
    method: "POST",
    agentId: aggregatorId,
  });
  assert(aggRes.data.outcome.passed === true, "Consensus: PASSED (majority)");
  assertNear(aggRes.data.outcome.qualityScore, 2 / 3, "Quality score = 2/3");
  assert(aggRes.data.task.status === "verified", `Task status is "verified"`);

  // ── 10. Publisher confirms → settlement ─────────────────────────────────
  section("Publisher confirms → settlement");
  const confirmRes = await api<{
    data: {
      task: { id: string; status: string };
      settlement: {
        id: string;
        feeTransfer: number;
        mintReward: number;
        validatorRewards: Record<string, number>;
        txHash: string;
        settledAt: string;
      };
    };
  }>(`/tasks/${taskId}/confirm`, {
    method: "POST",
    agentId: "publisher_1",
  });
  assert(confirmRes.data.task.status === "settled", `Task status is "settled"`);
  assert(confirmRes.data.settlement.id.length > 0, `Settlement ID exists`);
  assert(confirmRes.data.settlement.txHash.length > 0, `TxHash exists`);
  assert(confirmRes.data.settlement.feeTransfer > 0, `Fee transfer > 0`);
  assert(confirmRes.data.settlement.mintReward > 0, `Mint reward > 0`);

  // ── 11. Verify final balances ───────────────────────────────────────────
  section("Verify final balances");
  const finalBal: Record<string, number> = {};
  const finalStake: Record<string, number> = {};
  // Fetch for all AGENTS + selected validators (in case they differ)
  const allIds = new Set([...AGENTS.map((a) => a.id), ...selectedValidators]);
  for (const id of allIds) {
    const res = await api<{ data: { balance: number; stakeAmount: number } }>(
      `/agents/${id}`,
      { agentId: id },
    );
    finalBal[id] = res.data.balance;
    finalStake[id] = res.data.stakeAmount;
  }

  const pubDelta = finalBal["publisher_1"] - initBal["publisher_1"];
  const execDelta = finalBal["executor_1"] - initBal["executor_1"];

  // Publisher paid fee
  assertNear(pubDelta, -10, "Publisher delta = -10 (paid fee)");

  // Executor: fee + mint (complexity 1.5 × qualityScore 2/3 × baseMintRate 0.01 = 0.01)
  const expectedMint = 1.5 * (2 / 3) * 0.01;
  assertNear(execDelta, 10 + expectedMint, `Executor delta = fee + mint`);

  // Majority validators get +0.5, dissenter gets stake slashed by 1.0
  const passingValidators = selectedValidators.slice(0, 2);
  const dissentingValidator = selectedValidators[2];

  for (const vid of passingValidators) {
    const vBalDelta = finalBal[vid] - initBal[vid];
    assertNear(vBalDelta, 0.5, `${vid} balance +0.5 (majority validator reward)`);
  }

  const dissBalDelta = finalBal[dissentingValidator] - initBal[dissentingValidator];
  const dissStakeDelta = finalStake[dissentingValidator] - initStake[dissentingValidator];
  assertNear(dissBalDelta, 0, `${dissentingValidator} balance unchanged (dissenter)`);
  assertNear(dissStakeDelta, -1.0, `${dissentingValidator} stake -1.0 (slashed)`);

  // ── 12. Settlement record ───────────────────────────────────────────────
  section("Settlement record");
  const settlement = confirmRes.data.settlement;
  assert(settlement.validatorRewards[passingValidators[0]] === 0.5, "Validator reward for majority = 0.5");
  assert(settlement.validatorRewards[passingValidators[1]] === 0.5, "Validator reward for majority = 0.5");
  assert(
    settlement.validatorRewards[dissentingValidator] === -1.0,
    "Validator reward for dissenter = -1.0",
  );

  // ── 13. Reject flow (verified → re_verifying) ──────────────────────────
  section("Reject flow");
  const rejectTaskRes = await api<{ data: { id: string } }>("/tasks", {
    method: "POST",
    agentId: "publisher_1",
    body: {
      skill: "code",
      params: { code: "print('reject test')" },
      complexity: 1.0,
      fee: 5,
      ttl: 300,
    },
  });
  const rejectTaskId = rejectTaskRes.data.id;

  // Move through: published → accepted → submitted
  await api(`/tasks/${rejectTaskId}/accept`, { method: "POST", agentId: "executor_1" });
  const rejectSubmitRes = await api<{
    data: { task: { status: string }; validators: string[] };
  }>(`/tasks/${rejectTaskId}/submit`, {
    method: "POST",
    agentId: "executor_1",
    body: { result: { content: "reject test result" } },
  });
  const rejectValidators = rejectSubmitRes.data.validators;

  // All 3 validators vote PASS → task goes to "aggregating"
  let rejectAggregatorId = "";
  for (let i = 0; i < rejectValidators.length; i++) {
    const res = await api<{ data: { aggregating?: boolean; aggregatorId?: string } }>(`/tasks/${rejectTaskId}/verify`, {
      method: "POST",
      agentId: rejectValidators[i],
      body: { passed: true },
    });
    if (res.data.aggregating) {
      rejectAggregatorId = res.data.aggregatorId!;
    }
  }
  // Aggregator tallies → task goes to "verified"
  await api(`/tasks/${rejectTaskId}/aggregate`, {
    method: "POST",
    agentId: rejectAggregatorId,
  });
  const verifiedTask = await api<{ data: { status: string } }>(`/tasks/${rejectTaskId}`, { agentId: "publisher_1" });
  assert(verifiedTask.data.status === "verified", `Task is "verified" before reject`);

  // Publisher rejects → goes to re_verifying
  const rejectRes = await api<{ data: { status: string } }>(
    `/tasks/${rejectTaskId}/reject`,
    { method: "POST", agentId: "publisher_1" },
  );
  assert(rejectRes.data.status === "re_verifying", `Rejected task status is "re_verifying" (got "${rejectRes.data.status}")`);

  // ── 14. Validator list ──────────────────────────────────────────────────
  section("Validator list");
  const validatorList = await api<{
    data: { id: string; stakeAmount: number; reputation: number }[];
  }>("/validators", { agentId: "validator_1" });
  assert(validatorList.data.length >= 3, `At least 3 validators registered`);
  for (const v of validatorList.data) {
    assert(v.stakeAmount > 0, `${v.id} has stake > 0`);
  }

  // ── 15. Agent list ──────────────────────────────────────────────────────
  section("Agent list");
  const agentList = await api<{ data: { id: string; skills: string[] }[] }>(
    "/agents",
    { agentId: "publisher_1" },
  );
  assert(agentList.data.length >= AGENTS.length, `At least ${AGENTS.length} agents registered`);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════╗");
  console.log(`║  Results: ${passed} passed, ${failed} failed${" ".repeat(Math.max(0, 16 - String(passed).length - String(failed).length))}║`);
  console.log("╚══════════════════════════════════════════╝");

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n╔══════════════════════════════════════════╗`);
  console.error(`║  TEST FAILED (${passed} passed, ${failed} failed)         ║`);
  console.error("╚══════════════════════════════════════════╝");
  console.error(err);
  process.exit(1);
});
