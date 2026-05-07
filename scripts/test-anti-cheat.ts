/**
 * TALKEN Anti-Cheat (Commit-Reveal) Test
 *
 * Run: npx tsx scripts/test-anti-cheat.ts
 */

import { createHash } from "node:crypto";

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

function computeVoteHash(taskId: string, validatorId: string, passed: boolean, secret: string): string {
  return createHash("sha256").update(taskId + validatorId + String(passed) + secret).digest("hex");
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  TALKEN Anti-Cheat (Commit-Reveal) Test  ║");
  console.log("╚══════════════════════════════════════════╝");

  // Setup
  section("Setup agents");
  await api("POST", "/agents", { id: "ac_pub", name: "AC Publisher", skills: ["search"] }, "ac_pub");
  await api("PATCH", "/agents/ac_pub", { balance: 1000 }, "ac_pub");
  await api("POST", "/agents", { id: "ac_exec", name: "AC Executor", skills: ["search"] }, "ac_exec");

  const valIds = ["ac_val_1", "ac_val_2", "ac_val_3"];
  for (const id of valIds) {
    await api("POST", "/agents", { id, name: id, skills: ["verify"] }, id);
    await api("PATCH", `/agents/${id}`, { balance: 500 }, id);
    await api("POST", "/validators/stake", { amount: 200 }, id);
  }
  console.log("  All agents ready");

  // Create and submit task
  section("Create task and submit");
  const taskRes = await api("POST", "/tasks", {
    skill: "search", params: { query: "anti-cheat test" }, complexity: 1.0, fee: 10, ttl: 300,
  }, "ac_pub");
  const taskId = taskRes.data.data.id;

  await api("POST", `/tasks/${taskId}/accept`, {}, "ac_exec");
  const submitRes = await api("POST", `/tasks/${taskId}/submit`, { result: { content: "done" } }, "ac_exec");
  const validators: string[] = submitRes.data.data.validators;
  console.log(`  Validators: ${validators.join(", ")}`);

  // Phase 1: Commit
  section("Phase 1 — Commit votes");
  const secrets: Record<string, string> = {};
  const votes: Record<string, boolean> = {};

  // val_1 votes PASS
  secrets[validators[0]] = "secret_abc_123";
  votes[validators[0]] = true;
  const hash1 = computeVoteHash(taskId, validators[0], true, secrets[validators[0]]);
  const commit1 = await api("POST", `/tasks/${taskId}/commit`, { voteHash: hash1 }, validators[0]);
  assert(commit1.data.data.committed === true, `${validators[0]} committed`);
  assert(commit1.data.data.allCommitted === false, "Not all committed yet");

  // val_2 votes PASS
  secrets[validators[1]] = "secret_def_456";
  votes[validators[1]] = true;
  const hash2 = computeVoteHash(taskId, validators[1], true, secrets[validators[1]]);
  const commit2 = await api("POST", `/tasks/${taskId}/commit`, { voteHash: hash2 }, validators[1]);
  assert(commit2.data.data.allCommitted === false, "Still not all committed");

  // val_3 votes FAIL
  secrets[validators[2]] = "secret_ghi_789";
  votes[validators[2]] = false;
  const hash3 = computeVoteHash(taskId, validators[2], false, secrets[validators[2]]);
  const commit3 = await api("POST", `/tasks/${taskId}/commit`, { voteHash: hash3 }, validators[2]);
  assert(commit3.data.data.allCommitted === true, "All 3 committed");

  // Verify: cannot commit twice
  section("Commit duplicate prevention");
  const dupCommit = await api("POST", `/tasks/${taskId}/commit`, { voteHash: hash1 }, validators[0]);
  assert(dupCommit.status !== 200 || dupCommit.data.success === false, "Duplicate commit rejected");

  // Phase 2: Reveal
  section("Phase 2 — Reveal votes");

  // Reveal val_1
  const reveal1 = await api("POST", `/tasks/${taskId}/reveal`, { passed: true, secret: secrets[validators[0]] }, validators[0]);
  assert(reveal1.data.data.revealed === true, `${validators[0]} revealed`);
  assert(reveal1.data.data.allRevealed === false, "Not all revealed yet");

  // Reveal val_2
  const reveal2 = await api("POST", `/tasks/${taskId}/reveal`, { passed: true, secret: secrets[validators[1]] }, validators[1]);
  assert(reveal2.data.data.allRevealed === false, "Still not all revealed");

  // Reveal val_3
  const reveal3 = await api("POST", `/tasks/${taskId}/reveal`, { passed: false, secret: secrets[validators[2]] }, validators[2]);
  assert(reveal3.data.data.allRevealed === true, "All 3 revealed");

  // Verify: cannot reveal twice
  section("Reveal duplicate prevention");
  const dupReveal = await api("POST", `/tasks/${taskId}/reveal`, { passed: true, secret: secrets[validators[0]] }, validators[0]);
  assert(dupReveal.status !== 200 || dupReveal.data.success === false, "Duplicate reveal rejected");

  // Verify: invalid reveal (wrong secret)
  section("Invalid reveal detection");
  const badReveal = await api("POST", `/tasks/${taskId}/reveal`, { passed: true, secret: "wrong_secret" }, validators[0]);
  // Already revealed, so should fail with ALREADY_REVEALED
  assert(badReveal.status !== 200 || badReveal.data.success === false, "Already revealed rejected");

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
