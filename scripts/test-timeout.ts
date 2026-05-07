/**
 * TALKEN Timeout + Fallback Test
 *
 * Tests that timed-out validators get penalized and replaced,
 * and that tasks auto-cancel after max fallback rounds.
 *
 * Run: npx tsx scripts/test-timeout.ts
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

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  console.log("║  TALKEN Timeout + Fallback Test          ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── 1. Create task and submit ─────────────────────────────────────────
  section("Create task and submit result");
  const taskRes = await api<{ data: { id: string } }>("/tasks", {
    method: "POST",
    agentId: "publisher_1",
    body: {
      skill: "search",
      params: { query: "timeout test" },
      complexity: 1.0,
      fee: 5,
      ttl: 300,
    },
  });
  const taskId = taskRes.data.id;
  console.log(`  Task created: ${taskId}`);

  await api(`/tasks/${taskId}/accept`, { method: "POST", agentId: "executor_1" });
  const submitRes = await api<{ data: { validators: string[] } }>(`/tasks/${taskId}/submit`, {
    method: "POST",
    agentId: "executor_1",
    body: { result: { content: "timeout test result" } },
  });
  const selectedValidators = submitRes.data.validators;
  console.log(`  Task submitted, selected validators: ${selectedValidators.join(", ")}`);

  // ── 2. Record initial stakes ────────────────────────────────────────────
  section("Record initial validator stakes");
  const stakesBefore: Record<string, number> = {};
  for (const vid of selectedValidators) {
    const res = await api<{ data: { stakeAmount: number } }>(`/agents/${vid}`, { agentId: vid });
    stakesBefore[vid] = res.data.stakeAmount;
    console.log(`  ${vid} stake: ${stakesBefore[vid]}`);
  }

  // ── 3. Partial voting (1 of 3) ─────────────────────────────────────────
  section("Partial voting (1 of 3 validators)");
  const voter = selectedValidators[0];
  const nonVoters = selectedValidators.slice(1);
  await api(`/tasks/${taskId}/verify`, {
    method: "POST",
    agentId: voter,
    body: { passed: true },
  });
  console.log(`  ${voter} voted PASS`);

  // ── 4. Timeout round 1 ─────────────────────────────────────────────────
  section("Timeout round 1 — penalize non-voters");
  await api(`/debug/expire-session/${taskId}`, { method: "POST", agentId: "publisher_1" });
  const check1 = await api<{ cancelled: string[] }>(`/debug/check-timeout`, {
    method: "POST",
    agentId: "publisher_1",
  });
  assert(check1.cancelled.length === 0, `No tasks cancelled in round 1`);

  // Verify non-voters penalized
  for (const nv of nonVoters) {
    const res = await api<{ data: { stakeAmount: number } }>(`/agents/${nv}`, { agentId: nv });
    assertNear(res.data.stakeAmount, stakesBefore[nv] - 0.1, `${nv} penalized -0.1 after round 1`);
  }

  // ── 5. Timeout round 2 ─────────────────────────────────────────────────
  section("Timeout round 2");
  await sleep(100);
  await api(`/debug/expire-session/${taskId}`, { method: "POST", agentId: "publisher_1" });
  const check2 = await api<{ cancelled: string[] }>(`/debug/check-timeout`, {
    method: "POST",
    agentId: "publisher_1",
  });
  assert(check2.cancelled.length === 0, `No tasks cancelled in round 2`);

  // ── 6. Timeout round 3 — auto-cancel ───────────────────────────────────
  section("Timeout round 3 — auto-cancel");
  await sleep(100);
  await api(`/debug/expire-session/${taskId}`, { method: "POST", agentId: "publisher_1" });
  const check3 = await api<{ cancelled: string[] }>(`/debug/check-timeout`, {
    method: "POST",
    agentId: "publisher_1",
  });
  assert(check3.cancelled.length === 1, `1 task cancelled in round 3`);
  assert(check3.cancelled[0] === taskId, `Cancelled task is ${taskId}`);

  // ── 7. Verify final task status ────────────────────────────────────────
  section("Verify final task status");
  const finalTask = await api<{ data: { status: string } }>(`/tasks/${taskId}`, {
    agentId: "publisher_1",
  });
  assert(finalTask.data.status === "cancelled", `Task status is "cancelled"`);

  // ── 8. Verify cumulative penalties ─────────────────────────────────────
  section("Verify cumulative penalties");
  // Non-voters get penalized in rounds 1 and 2 (×0.1 each = -0.2 total)
  // Round 3 cancels the task before applying penalties (session deleted)
  for (const nv of nonVoters) {
    const res = await api<{ data: { stakeAmount: number } }>(`/agents/${nv}`, { agentId: nv });
    assertNear(res.data.stakeAmount, stakesBefore[nv] - 0.2, `${nv} total penalty: -0.2`);
  }

  // voter should have no penalty
  const voterFinal = await api<{ data: { stakeAmount: number } }>(`/agents/${voter}`, { agentId: voter });
  assertNear(voterFinal.data.stakeAmount, stakesBefore[voter], `${voter} no penalty (voted)`);

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
