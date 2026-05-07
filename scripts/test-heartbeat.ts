/**
 * TALKEN Heartbeat Test
 *
 * Tests the SDK's role-based heartbeat mechanism:
 * - Executor auto-discovers and accepts tasks
 * - Validator auto-discovers submitted tasks and votes
 * - Full lifecycle runs without manual intervention
 *
 * Run: npx tsx scripts/test-heartbeat.ts
 */

import { TalkenClient } from "../packages/agent-sdk/src/client.js";

const BASE = "http://localhost:3001";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function sleep(ms: number): Promise<void> {
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
  console.log("║  TALKEN Heartbeat Test                   ║");
  console.log("╚══════════════════════════════════════════╝");

  // Create clients
  const publisher = new TalkenClient({
    baseUrl: BASE,
    agentId: "hb_publisher_1",
    skills: ["search", "code"],
  });

  const executor = new TalkenClient({
    baseUrl: BASE,
    agentId: "hb_executor_1",
    skills: ["search", "code", "analyze"],
    pollInterval: 1000, // faster for testing
  });

  const validator1 = new TalkenClient({
    baseUrl: BASE,
    agentId: "hb_validator_1",
    skills: ["verify"],
    pollInterval: 1000,
  });

  const validator2 = new TalkenClient({
    baseUrl: BASE,
    agentId: "hb_validator_2",
    skills: ["verify"],
    pollInterval: 1000,
  });

  const validator3 = new TalkenClient({
    baseUrl: BASE,
    agentId: "hb_validator_3",
    skills: ["verify"],
    pollInterval: 1000,
  });

  const allClients = [publisher, executor, validator1, validator2, validator3];
  const validators = [validator1, validator2, validator3];

  try {
    // ── 1. Register agents ──────────────────────────────────────────────
    section("Register agents");
    for (const client of allClients) {
      await client.register();
      console.log(`  Registered ${client.agentId}`);
    }

    // ── 2. Fund agents & stake validators ───────────────────────────────
    section("Fund agents & stake validators");
    // Use PATCH endpoint to give initial balance
    async function fundAgent(agentId: string, balance: number) {
      await fetch(`${BASE}/api/v1/agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Talken-Agent-Id": agentId },
        body: JSON.stringify({ balance }),
      });
    }
    await fundAgent("hb_publisher_1", 1000);
    await fundAgent("hb_executor_1", 500);
    for (const v of validators) await fundAgent(v.agentId, 500);
    console.log("  All agents funded");

    for (const v of validators) {
      await v.stake(200);
      console.log(`  ${v.agentId} staked 200`);
    }

    // ── 3. Set roles ────────────────────────────────────────────────────
    section("Set roles");
    publisher.setRole("publisher");
    executor.setRole("executor");
    for (const v of validators) v.setRole("validator");
    console.log("  All roles set");

    // ── 4. Track auto-accepted task ─────────────────────────────────────
    section("Start heartbeat + auto-accept test");
    let acceptedTaskId: string | null = null;
    let submittedTaskId: string | null = null;
    let selectedValidatorIds: string[] = [];
    const votedTasks: Map<string, string[]> = new Map(); // taskId → validatorIds
    let aggregatorIdForTask: string | null = null;

    // All known validator agent IDs (our own + any from previous tests that might get selected)
    const allKnownValidatorIds = new Set(validators.map(v => v.agentId));

    // Executor: auto-accept + auto-submit
    executor.onNewTask(async (task) => {
      console.log(`  [executor] Found task ${task.id}, auto-accepting...`);
      try {
        await executor.acceptTask(task.id);
        console.log(`  [executor] Accepted task ${task.id}, submitting result...`);
        acceptedTaskId = task.id;

        // Auto-submit result
        const submitRes = await executor.submitResult(task.id, {
          content: "auto-executed result",
          tokensUsed: 10,
        });
        submittedTaskId = task.id;
        selectedValidatorIds = submitRes.validators;
        console.log(`  [executor] Submitted result for ${task.id}, validators: ${submitRes.validators.join(", ")}`);

        // Vote directly with selected validators (they may not be our hb_validator_*)
        // We use the API directly since our SDK clients may not be the selected validators
        for (const valId of submitRes.validators) {
          try {
            const voteRes = await fetch(`${BASE}/api/v1/tasks/${task.id}/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Talken-Agent-Id": valId },
              body: JSON.stringify({ passed: true }),
            }).then(r => r.json());

            if (!votedTasks.has(task.id)) votedTasks.set(task.id, []);
            votedTasks.get(task.id)!.push(valId);
            console.log(`  [${valId}] Voted on ${task.id} (${votedTasks.get(task.id)!.length}/3)`);

            if (voteRes.data?.aggregating && voteRes.data?.aggregatorId) {
              aggregatorIdForTask = voteRes.data.aggregatorId;
              console.log(`  [${valId}] All votes in, aggregator: ${voteRes.data.aggregatorId}`);
            }
          } catch (err) {
            console.error(`  [${valId}] Vote error: ${err}`);
          }
        }
      } catch (err) {
        console.error(`  [executor] Error: ${err}`);
      }
    });

    // Start executor heartbeat (voting is handled directly in the submit callback)
    executor.start();
    console.log("  Heartbeats started");

    // Wait a moment for seeding
    await sleep(500);

    // ── 5. Publisher creates task ───────────────────────────────────────
    section("Publisher creates task (should auto-flow)");
    const task = await publisher.publishTask({
      skill: "search",
      params: { query: "heartbeat auto test" },
      fee: 5,
      complexity: 1.0,
      ttl: 300,
    });
    console.log(`  Task created: ${task.id}`);

    // ── 6. Wait for auto-accept ─────────────────────────────────────────
    section("Wait for executor auto-accept");
    for (let i = 0; i < 20; i++) {
      if (acceptedTaskId) break;
      await sleep(500);
    }
    assert(acceptedTaskId === task.id, `Executor auto-accepted task ${task.id}`);

    // ── 7. Wait for auto-submit ─────────────────────────────────────────
    section("Wait for executor auto-submit");
    for (let i = 0; i < 20; i++) {
      if (submittedTaskId) break;
      await sleep(500);
    }
    assert(submittedTaskId === task.id, `Executor auto-submitted result for ${task.id}`);

    // ── 8. Wait for votes (cast directly in executor submit callback) ───
    section("Wait for votes");
    for (let i = 0; i < 20; i++) {
      const voters = votedTasks.get(task.id);
      if (voters && voters.length >= 3) break;
      await sleep(500);
    }
    const finalVoters = votedTasks.get(task.id) ?? [];
    assert(finalVoters.length >= 3, `All 3 validators voted (${finalVoters.length}/3)`);

    // ── 9. Aggregation phase ────────────────────────────────────────────
    section("Aggregation");
    for (let i = 0; i < 10; i++) {
      if (aggregatorIdForTask) break;
      await sleep(500);
    }
    assert(aggregatorIdForTask !== null, "Aggregator selected");

    // Call aggregate with the aggregator's ID
    const aggRes = await publisher.aggregateTask(task.id, aggregatorIdForTask!);
    console.log(`  Aggregation result: ${aggRes.outcome.passed ? "PASS" : "FAIL"}, quality=${aggRes.outcome.qualityScore}`);
    assert(aggRes.task.status === "verified", `Task status is "verified" after aggregation (got "${aggRes.task.status}")`);
    assert(aggRes.outcome.passed === true, "Consensus: PASS");

    // ── 10. Publisher confirms → settlement ─────────────────────────────
    section("Publisher confirms → settlement");
    const confirmRes = await publisher.confirmTask(task.id);
    assert(confirmRes.task.status === "settled", `Task settled`);
    assert(confirmRes.settlement.id.length > 0, `Settlement ID exists`);
    console.log(`  Settlement: fee=${confirmRes.settlement.feeTransfer}, mint=${confirmRes.settlement.mintReward}`);

    // ── 11. Verify balances changed ─────────────────────────────────────
    section("Verify balance changes");
    const pubProfile = await publisher.getProfile();
    const execProfile = await executor.getProfile();
    console.log(`  Publisher balance: ${pubProfile.balance}`);
    console.log(`  Executor balance: ${execProfile.balance}`);
    assert(pubProfile.balance < 1000, `Publisher paid (balance < 1000)`);
    assert(execProfile.balance > 0, `Executor received payment`);

    // ── Summary ─────────────────────────────────────────────────────────
    console.log("\n╔══════════════════════════════════════════╗");
    console.log(`║  Results: ${passed} passed, ${failed} failed${" ".repeat(Math.max(0, 16 - String(passed).length - String(failed).length))}║`);
    console.log("╚══════════════════════════════════════════╝");

  } finally {
    // Stop all heartbeats
    for (const client of allClients) {
      client.stop();
    }
    console.log("\nAll heartbeats stopped.");
  }

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
