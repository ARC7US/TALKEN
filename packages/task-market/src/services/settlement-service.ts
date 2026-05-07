import { rawRun, rawGet, rawAll } from "../db/connection.js";
import {
  generateId,
  BASE_MINT_RATE,
  VALIDATOR_FIXED_REWARD,
  SLASH_MULTIPLIER,
} from "@talken/shared";
import type { Settlement, RewardBreakdown } from "@talken/shared";
import { getTaskOrThrow, updateTaskStatus, checkParentCompletion } from "./task-service.js";
import { getAgentOrThrow, updateAgentReputation } from "./agent-service.js";
import { getVotes, identifyDissenters } from "./verification-service.js";
import { cleanupRelayData } from "./relay-cleanup.js";
import type { StellarService } from "../stellar/index.js";

interface SettlementRow {
  id: string;
  task_id: string;
  publisher_id: string;
  executor_id: string;
  fee_transfer: number;
  mint_reward: number;
  validator_rewards: string;
  tx_hash: string;
  settled_at: string;
}

function mapSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    taskId: row.task_id,
    publisherId: row.publisher_id,
    executorId: row.executor_id,
    feeTransfer: row.fee_transfer,
    mintReward: row.mint_reward,
    validatorRewards: JSON.parse(row.validator_rewards),
    txHash: row.tx_hash,
    settledAt: row.settled_at,
  };
}

export function calculateRewards(taskId: string): RewardBreakdown {
  const task = getTaskOrThrow(taskId);
  const qualityScore = task.qualityScore ?? 0;

  const executorFee = task.fee;
  const executorMint = task.complexity * qualityScore * BASE_MINT_RATE;
  const executorTotal = executorFee + executorMint;

  const votes = getVotes(taskId);
  const consensusPassed = task.consensusResult ?? true;
  const dissenters = identifyDissenters(taskId, consensusPassed);

  const validatorRewards = votes.map((vote) => {
    const isDissenter = dissenters.includes(vote.validatorId);
    const amount = isDissenter ? -VALIDATOR_FIXED_REWARD * SLASH_MULTIPLIER : VALIDATOR_FIXED_REWARD;
    return { validatorId: vote.validatorId, amount };
  });

  return {
    executorFee,
    executorMint,
    executorTotal,
    validatorRewards,
  };
}

export async function executeSettlement(
  taskId: string,
  stellar: StellarService
): Promise<Settlement> {
  const task = getTaskOrThrow(taskId);
  if (!task.executorId) throw new Error("Task has no executor");

  const rewards = calculateRewards(taskId);
  const publisher = getAgentOrThrow(task.publisherId);
  const executor = getAgentOrThrow(task.executorId);

  // Transfer fee from publisher to executor
  const feeTxHash = await stellar.transfer(publisher.id, executor.id, rewards.executorFee);

  // Mint reward to executor
  const mintTxHash = await stellar.protocolMint(executor.id, rewards.executorMint);

  // Reward/slash validators
  const validatorRewards: Record<string, number> = {};
  for (const vr of rewards.validatorRewards) {
    if (vr.amount > 0) {
      await stellar.protocolMint(vr.validatorId, vr.amount);
    } else {
      await stellar.protocolSlash(vr.validatorId, Math.abs(vr.amount));
    }
    validatorRewards[vr.validatorId] = vr.amount;

    // Update validator reputation
    const validator = getAgentOrThrow(vr.validatorId);
    const repDelta = vr.amount > 0 ? 0.01 : -0.02;
    updateAgentReputation(vr.validatorId, Math.max(0, validator.reputation + repDelta));
  }

  // Update executor reputation
  const qualityScore = task.qualityScore ?? 0;
  updateAgentReputation(executor.id, executor.reputation + qualityScore * 0.05);

  // Insert settlement record
  const id = generateId("settle_");
  const now = new Date().toISOString();
  rawRun(
    `INSERT INTO settlements (id, task_id, publisher_id, executor_id, fee_transfer, mint_reward, validator_rewards, tx_hash, settled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      task.id,
      task.publisherId,
      task.executorId,
      rewards.executorFee,
      rewards.executorMint,
      JSON.stringify(validatorRewards),
      feeTxHash,
      now,
    ]
  );

  // Update task status to settled
  rawRun("UPDATE tasks SET status = 'settled', updated_at = ? WHERE id = ?", [now, taskId]);

  // Clean up relay data (terminal state)
  cleanupRelayData(taskId);

  // Check if parent task should auto-settle
  checkParentCompletion(taskId);

  return getSettlement(taskId)!;
}

export function getSettlement(taskId: string): Settlement | undefined {
  const row = rawGet<SettlementRow>("SELECT * FROM settlements WHERE task_id = ?", [taskId]);
  return row ? mapSettlement(row) : undefined;
}

export function listSettlements(): Settlement[] {
  const rows = rawAll<SettlementRow>("SELECT * FROM settlements ORDER BY settled_at DESC");
  return rows.map(mapSettlement);
}
