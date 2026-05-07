import { rawRun, rawGet, rawAll } from "../db/connection.js";
import {
  TaskNotFoundError,
  InvalidTransitionError,
  AlreadyAcceptedError,
  TaskExpiredError,
  ErrorCodes,
  TalkenError,
  generateId,
  LEVEL_VALIDATOR_COUNT,
  LEVEL_MIN_REPUTATION,
  MIN_REPUTATION_THRESHOLD,
} from "@talken/shared";
import type { Task, VerificationVote, Settlement } from "@talken/shared";
import { canTransition, getNextStatus } from "../state-machine/task-lifecycle.js";
import { cleanupRelayData } from "./relay-cleanup.js";
import { listAgents } from "./agent-service.js";

interface TaskRow {
  id: string;
  publisher_id: string;
  executor_id: string | null;
  skill: string;
  params: string;
  result: string | null;
  complexity: number;
  fee: number;
  level: number;
  parent_task_id: string | null;
  depth: number;
  status: string;
  ttl: number;
  signature: string;
  quality_score: number | null;
  consensus_result: number | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    executorId: row.executor_id,
    skill: row.skill,
    params: JSON.parse(row.params),
    result: row.result ? JSON.parse(row.result) : null,
    complexity: row.complexity,
    level: row.level,
    parentTaskId: row.parent_task_id,
    depth: row.depth,
    fee: row.fee,
    status: row.status,
    ttl: row.ttl,
    signature: row.signature,
    qualityScore: row.quality_score,
    consensusResult: row.consensus_result !== null ? Boolean(row.consensus_result) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Determine task level based on complexity.
 * Lv.1: complexity < 1.0
 * Lv.2: 1.0 <= complexity < 1.5
 * Lv.3: 1.5 <= complexity < 2.0
 * Lv.4: 2.0 <= complexity < 3.0
 * Lv.5: complexity >= 3.0
 */
export function getTaskLevel(complexity: number): number {
  if (complexity < 1.0) return 1;
  if (complexity < 1.5) return 2;
  if (complexity < 2.0) return 3;
  if (complexity < 3.0) return 4;
  return 5;
}

export function createTask(input: {
  publisherId: string;
  skill: string;
  params: Record<string, unknown>;
  complexity: number;
  fee: number;
  ttl: number;
  signature: string;
  parentTaskId?: string;
  depth?: number;
}): Task {
  const id = generateId("task_");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + input.ttl * 1000).toISOString();
  const level = getTaskLevel(input.complexity);
  const parentTaskId = input.parentTaskId ?? null;
  const depth = input.depth ?? 0;

  rawRun(
    `INSERT INTO tasks (id, publisher_id, executor_id, skill, params, result, complexity, fee, level, parent_task_id, depth, status, ttl, signature, quality_score, consensus_result, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.publisherId, null, input.skill, JSON.stringify(input.params), null, input.complexity, input.fee, level, parentTaskId, depth, "published", input.ttl, input.signature, null, null, now, now, expiresAt]
  );

  return getTaskOrThrow(id);
}

export function getTask(taskId: string): Task | undefined {
  const row = rawGet<TaskRow>("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!row) return undefined;

  const task = mapTask(row);

  // Load votes
  const votes = rawAll<{ id: string; task_id: string; validator_id: string; passed: number; created_at: string }>(
    "SELECT * FROM verification_votes WHERE task_id = ?",
    [taskId]
  );
  task.verificationVotes = votes.map((v) => ({
    id: v.id,
    taskId: v.task_id,
    validatorId: v.validator_id,
    passed: Boolean(v.passed),
    createdAt: v.created_at,
  }));

  // Load settlement
  const settlementRow = rawGet<{
    id: string;
    task_id: string;
    publisher_id: string;
    executor_id: string;
    fee_transfer: number;
    mint_reward: number;
    validator_rewards: string;
    tx_hash: string;
    settled_at: string;
  }>("SELECT * FROM settlements WHERE task_id = ?", [taskId]);
  if (settlementRow) {
    task.settlement = {
      id: settlementRow.id,
      taskId: settlementRow.task_id,
      publisherId: settlementRow.publisher_id,
      executorId: settlementRow.executor_id,
      feeTransfer: settlementRow.fee_transfer,
      mintReward: settlementRow.mint_reward,
      validatorRewards: JSON.parse(settlementRow.validator_rewards),
      txHash: settlementRow.tx_hash,
      settledAt: settlementRow.settled_at,
    };
  }

  return task;
}

export function getTaskOrThrow(taskId: string): Task {
  const task = getTask(taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return task;
}

export function listTasks(filters?: {
  status?: string;
  skill?: string;
  publisherId?: string;
  executorId?: string;
  limit?: number;
  offset?: number;
}): Task[] {
  let sql = "SELECT * FROM tasks WHERE 1=1";
  const params: unknown[] = [];

  if (filters?.status) {
    sql += " AND status = ?";
    params.push(filters.status);
  }
  if (filters?.skill) {
    sql += " AND skill = ?";
    params.push(filters.skill);
  }
  if (filters?.publisherId) {
    sql += " AND publisher_id = ?";
    params.push(filters.publisherId);
  }
  if (filters?.executorId) {
    sql += " AND executor_id = ?";
    params.push(filters.executorId);
  }

  sql += " ORDER BY created_at DESC";

  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }
  if (filters?.offset) {
    sql += " OFFSET ?";
    params.push(filters.offset);
  }

  const rows = rawAll<TaskRow>(sql, params);
  return rows.map(mapTask);
}

/**
 * Find the best executor for a task.
 * Filters by: skill match + reputation >= threshold + not already busy.
 * Sorts by: reputation × skill match score.
 * Returns null if no suitable executor found.
 */
export function matchExecutor(task: { skill: string; level: number }): string | null {
  const allAgents = listAgents();

  // Filter: must have the skill, meet level reputation, and not be a validator (stake > 0 means validator)
  const minRep = LEVEL_MIN_REPUTATION[task.level] ?? 0;
  const candidates = allAgents.filter((a) => {
    const hasSkill = a.skills.includes(task.skill);
    const hasRep = a.reputation >= Math.max(MIN_REPUTATION_THRESHOLD, minRep);
    const isNotValidator = a.stakeAmount === 0; // Executors don't stake
    return hasSkill && hasRep && isNotValidator;
  });

  if (candidates.length === 0) return null;

  // Score: reputation × skill match
  const scored = candidates.map((a) => ({
    id: a.id,
    score: a.reputation * (a.skills.includes(task.skill) ? 1.0 : 0.5),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].id;
}

export function updateTaskStatus(taskId: string, event: string): Task {
  const task = getTaskOrThrow(taskId);

  if (!canTransition(task.status, event)) {
    throw new InvalidTransitionError(task.status, event);
  }

  const newStatus = getNextStatus(task.status, event);
  if (!newStatus) throw new InvalidTransitionError(task.status, event);

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", [newStatus, now, taskId]);

  return getTaskOrThrow(taskId);
}

export function acceptTask(taskId: string, executorId: string): Task {
  const task = getTaskOrThrow(taskId);

  if (task.status !== "published") {
    throw new AlreadyAcceptedError(taskId);
  }

  if (new Date(task.expiresAt) < new Date()) {
    throw new TaskExpiredError(taskId);
  }

  if (!canTransition(task.status, "ACCEPT")) {
    throw new InvalidTransitionError(task.status, "ACCEPT");
  }

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET executor_id = ?, status = 'accepted', updated_at = ? WHERE id = ?", [executorId, now, taskId]);

  return getTaskOrThrow(taskId);
}

export function submitResult(taskId: string, result: Record<string, unknown>): Task {
  const task = getTaskOrThrow(taskId);

  if (new Date(task.expiresAt) < new Date()) {
    throw new TaskExpiredError(taskId);
  }

  if (!canTransition(task.status, "SUBMIT")) {
    throw new InvalidTransitionError(task.status, "SUBMIT");
  }

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET result = ?, status = 'submitted', updated_at = ? WHERE id = ?", [JSON.stringify(result), now, taskId]);

  return getTaskOrThrow(taskId);
}

export function handleVerificationOutcome(taskId: string, passed: boolean, qualityScore: number): Task {
  const task = getTaskOrThrow(taskId);

  const event = passed ? "VALIDATE_PASS" : "VALIDATE_FAIL";
  if (!canTransition(task.status, event)) {
    throw new InvalidTransitionError(task.status, event);
  }

  const now = new Date().toISOString();
  const newStatus = passed ? "verified" : "rejected";
  rawRun(
    "UPDATE tasks SET status = ?, quality_score = ?, consensus_result = ?, updated_at = ? WHERE id = ?",
    [newStatus, qualityScore, passed ? 1 : 0, now, taskId]
  );

  return getTaskOrThrow(taskId);
}

export function confirmTask(taskId: string): Task {
  const task = getTaskOrThrow(taskId);

  if (!canTransition(task.status, "CONFIRM")) {
    throw new InvalidTransitionError(task.status, "CONFIRM");
  }

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET status = 'confirmed', updated_at = ? WHERE id = ?", [now, taskId]);

  return getTaskOrThrow(taskId);
}

export function rejectTask(taskId: string): Task {
  const task = getTaskOrThrow(taskId);

  if (!canTransition(task.status, "REJECT")) {
    throw new InvalidTransitionError(task.status, "REJECT");
  }

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET status = 're_verifying', updated_at = ? WHERE id = ?", [now, taskId]);

  return getTaskOrThrow(taskId);
}

export function handleReverifyOutcome(taskId: string, passed: boolean, qualityScore: number): Task {
  const task = getTaskOrThrow(taskId);

  const event = passed ? "REVERIFY_PASS" : "REVERIFY_FAIL";
  if (!canTransition(task.status, event)) {
    throw new InvalidTransitionError(task.status, event);
  }

  const now = new Date().toISOString();
  const newStatus = passed ? "verified" : "rejected";
  rawRun(
    "UPDATE tasks SET status = ?, quality_score = ?, consensus_result = ?, updated_at = ? WHERE id = ?",
    [newStatus, qualityScore, passed ? 1 : 0, now, taskId]
  );

  // Clean up relay data if task is rejected (terminal state)
  if (!passed) {
    cleanupRelayData(taskId);
  }

  return getTaskOrThrow(taskId);
}

export function settleTask(taskId: string): Task {
  const task = getTaskOrThrow(taskId);

  if (!canTransition(task.status, "SETTLE")) {
    throw new InvalidTransitionError(task.status, "SETTLE");
  }

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET status = 'settled', updated_at = ? WHERE id = ?", [now, taskId]);

  return getTaskOrThrow(taskId);
}

export function expireTask(taskId: string): Task {
  const task = getTaskOrThrow(taskId);

  if (!canTransition(task.status, "EXPIRE")) {
    throw new InvalidTransitionError(task.status, "EXPIRE");
  }

  const now = new Date().toISOString();
  rawRun("UPDATE tasks SET status = 'expired', updated_at = ? WHERE id = ?", [now, taskId]);

  // Clean up relay data (terminal state)
  cleanupRelayData(taskId);

  return getTaskOrThrow(taskId);
}

export function getSubtasks(parentTaskId: string): Task[] {
  const rows = rawAll<TaskRow>(
    "SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY created_at ASC",
    [parentTaskId]
  );
  return rows.map(mapTask);
}

export function splitTask(
  taskId: string,
  subtasks: Array<{ skill: string; params: Record<string, unknown>; complexity: number; fee: number; ttl: number }>
): Task[] {
  const parentTask = getTaskOrThrow(taskId);
  if (parentTask.depth >= 2) {
    throw new Error("Maximum delegation depth (3 layers) reached");
  }
  if (subtasks.length === 0) {
    throw new Error("Must provide at least one subtask");
  }

  const childDepth = parentTask.depth + 1;
  const created: Task[] = [];

  for (const sub of subtasks) {
    const task = createTask({
      publisherId: parentTask.publisherId,
      skill: sub.skill ?? parentTask.skill,
      params: sub.params,
      complexity: sub.complexity,
      fee: sub.fee,
      ttl: sub.ttl ?? parentTask.ttl,
      signature: parentTask.signature,
      parentTaskId: taskId,
      depth: childDepth,
    });
    created.push(task);
  }

  return created;
}

export function checkParentCompletion(taskId: string): void {
  const task = getTaskOrThrow(taskId);
  if (!task.parentTaskId) return;

  const siblings = getSubtasks(task.parentTaskId);
  const allSettled = siblings.every((s) => s.status === "settled");

  if (allSettled) {
    // Auto-settle parent task
    const now = new Date().toISOString();
    rawRun(
      "UPDATE tasks SET status = 'settled', updated_at = ? WHERE id = ? AND status != 'settled'",
      [now, task.parentTaskId]
    );
  }
}
