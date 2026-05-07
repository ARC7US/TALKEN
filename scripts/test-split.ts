/**
 * TALKEN Task Splitting Test
 *
 * Run: npx tsx scripts/test-split.ts
 */

const BASE = "http://localhost:3001/api/v1";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) { failed++; throw new Error(`FAIL: ${message}`); }
  passed++;
  console.log(`  ✓ ${message}`);
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

let sectionNum = 0;
function section(title: string) { sectionNum++; console.log(`\n┌─ ${sectionNum}. ${title}`); }

async function api(method: string, path: string, body?: unknown, agentId?: string): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (agentId) headers["X-Talken-Agent-Id"] = agentId;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  return { status: res.status, data };
}

async function settleTask(taskId: string, publisherId: string, executorId: string): Promise<void> {
  await api("POST", `/tasks/${taskId}/accept`, {}, executorId);
  const submitRes = await api("POST", `/tasks/${taskId}/submit`, { result: { content: "done" } }, executorId);
  const validators: string[] = submitRes.data.data.validators;

  let aggregatorId = "";
  for (const vid of validators) {
    const res = await api("POST", `/tasks/${taskId}/verify`, { passed: true }, vid);
    if (res.data.data.aggregating) aggregatorId = res.data.data.aggregatorId;
  }
  await api("POST", `/tasks/${taskId}/aggregate`, {}, aggregatorId);
  await api("POST", `/tasks/${taskId}/confirm`, {}, publisherId);
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TALKEN Task Splitting Test              ║");
  console.log("╚══════════════════════════════════════════╝");

  // Setup
  section("Setup agents");
  await api("POST", "/agents", { id: "split_pub", name: "Publisher", skills: ["search"] }, "split_pub");
  await api("PATCH", "/agents/split_pub", { balance: 5000 }, "split_pub");

  for (let i = 1; i <= 5; i++) {
    await api("POST", "/agents", { id: `split_exec_${i}`, name: `Executor ${i}`, skills: ["search"] }, `split_exec_${i}`);
  }

  // Need validators for verification
  for (let i = 1; i <= 5; i++) {
    const id = `split_val_${i}`;
    await api("POST", "/agents", { id, name: `Val ${i}`, skills: ["verify"] }, id);
    await api("PATCH", `/agents/${id}`, { balance: 500 }, id);
    await api("POST", "/validators/stake", { amount: 200 }, id);
  }
  console.log("  All agents ready");

  // 1. Create parent task
  section("Create parent task");
  const parentRes = await api("POST", "/tasks", {
    skill: "search", params: { query: "big task" }, complexity: 2.0, fee: 30, ttl: 600,
  }, "split_pub");
  const parentId = parentRes.data.data.id;
  assert(parentRes.data.data.level === 4, `Parent task level is 4 (got ${parentRes.data.data.level})`);
  assert(parentRes.data.data.depth === 0, `Parent task depth is 0`);
  console.log(`  Parent task: ${parentId}`);

  // 2. Split into 3 subtasks
  section("Split into 3 subtasks");
  const splitRes = await api("POST", `/tasks/${parentId}/split`, {
    subtasks: [
      { skill: "search", params: { query: "subtask 1" }, complexity: 1.0, fee: 10, ttl: 300 },
      { skill: "search", params: { query: "subtask 2" }, complexity: 1.0, fee: 10, ttl: 300 },
      { skill: "search", params: { query: "subtask 3" }, complexity: 1.0, fee: 10, ttl: 300 },
    ],
  }, "split_pub");
  assert(splitRes.status === 201, "Split created 3 subtasks");
  const subtasks = splitRes.data.data.subtasks;
  assert(subtasks.length === 3, `Got ${subtasks.length} subtasks`);
  assert(subtasks[0].parentTaskId === parentId, `Subtask 1 parent is ${parentId.slice(0, 15)}...`);
  assert(subtasks[0].depth === 1, `Subtask depth is 1`);
  const subtaskIds = subtasks.map((s: any) => s.id);

  // 3. Get subtasks via API
  section("Get subtasks via API");
  const getSubs = await api("GET", `/tasks/${parentId}/subtasks`, undefined, "split_pub");
  assert(getSubs.data.data.length === 3, `GET subtasks returns 3`);

  // 4. Settle all 3 subtasks
  section("Settle all 3 subtasks");
  for (let i = 0; i < 3; i++) {
    await settleTask(subtaskIds[i], "split_pub", `split_exec_${i + 1}`);
    console.log(`  Subtask ${i + 1} settled`);
  }

  // 5. Verify all subtasks are settled
  section("Verify subtask statuses");
  for (const id of subtaskIds) {
    const detail = await api("GET", `/tasks/${id}`, undefined, "split_pub");
    assert(detail.data.data.status === "settled", `Subtask ${id.slice(0, 15)}... is settled`);
  }

  // 6. Check parent auto-settled
  section("Check parent auto-settlement");
  const parentDetail = await api("GET", `/tasks/${parentId}`, undefined, "split_pub");
  assert(parentDetail.data.data.status === "settled", `Parent task auto-settled`);

  // 7. Test depth limit
  section("Depth limit (max 3 layers)");
  // Create a depth-0 task
  const d0 = await api("POST", "/tasks", {
    skill: "search", params: { query: "depth 0" }, complexity: 2.0, fee: 10, ttl: 300,
  }, "split_pub");
  const d0Id = d0.data.data.id;

  // Split to depth 1
  const d1 = await api("POST", `/tasks/${d0Id}/split`, {
    subtasks: [{ skill: "search", params: { query: "depth 1" }, complexity: 1.0, fee: 5, ttl: 300 }],
  }, "split_pub");
  const d1Id = d1.data.data.subtasks[0].id;
  assert(d1.data.data.subtasks[0].depth === 1, "Depth 1 subtask");

  // Split to depth 2
  const d2 = await api("POST", `/tasks/${d1Id}/split`, {
    subtasks: [{ skill: "search", params: { query: "depth 2" }, complexity: 0.5, fee: 2, ttl: 300 }],
  }, "split_pub");
  assert(d2.data.data.subtasks[0].depth === 2, "Depth 2 subtask");

  // Split to depth 3 should fail
  const d2Id = d2.data.data.subtasks[0].id;
  const d3 = await api("POST", `/tasks/${d2Id}/split`, {
    subtasks: [{ skill: "search", params: { query: "depth 3" }, complexity: 0.5, fee: 1, ttl: 300 }],
  }, "split_pub");
  assert(d3.status !== 201 || d3.data.success === false, "Depth 3 rejected (max 3 layers)");

  // Summary
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
