import { rawRun, rawGet, rawAll } from "../db/connection.js";
import { createHash } from "node:crypto";
import {
  ValidatorNotSelectedError,
  NotAggregatorError,
  ErrorCodes,
  TalkenError,
  generateId,
  VALIDATOR_COUNT,
  LEVEL_VALIDATOR_COUNT,
} from "@talken/shared";
import type { VerificationVote, ConsensusOutcome, BlindVote, AggregationSession } from "@talken/shared";
import { listValidators } from "./agent-service.js";
import { cleanupRelayData } from "./relay-cleanup.js";

const VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FALLBACK_COUNT = 2;

interface VoteRow {
  id: string;
  task_id: string;
  validator_id: string;
  passed: number;
  created_at: string;
}

interface SessionRow {
  task_id: string;
  selected_validators: string;
  fallback_count: number;
  created_at: string;
  expires_at: string;
}

function mapVote(row: VoteRow): VerificationVote {
  return {
    id: row.id,
    taskId: row.task_id,
    validatorId: row.validator_id,
    passed: Boolean(row.passed),
    createdAt: row.created_at,
  };
}

export function selectValidators(taskId: string, excludeIds: string[] = [], count?: number): string[] {
  const validatorCount = count ?? VALIDATOR_COUNT;
  const validators = listValidators();
  if (validators.length === 0) return [];

  // Deterministic selection based on task hash
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = (hash * 31 + taskId.charCodeAt(i)) & 0x7fffffff;
  }

  const filtered = validators.filter((v) => !excludeIds.includes(v.id));
  const shuffled = [...filtered].sort((a, b) => {
    const hashA = (hash * 31 + a.id.charCodeAt(0)) & 0x7fffffff;
    const hashB = (hash * 31 + b.id.charCodeAt(0)) & 0x7fffffff;
    return hashA - hashB;
  });

  return shuffled.slice(0, Math.min(validatorCount, shuffled.length)).map((v) => v.id);
}

export function createVerificationSession(taskId: string, level?: number): string[] {
  const count = level ? LEVEL_VALIDATOR_COUNT[level] ?? VALIDATOR_COUNT : VALIDATOR_COUNT;
  const selectedValidators = selectValidators(taskId, [], count);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VERIFICATION_TIMEOUT_MS).toISOString();

  rawRun(
    `INSERT OR REPLACE INTO verification_sessions (task_id, selected_validators, fallback_count, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [taskId, JSON.stringify(selectedValidators), 0, now.toISOString(), expiresAt]
  );

  return selectedValidators;
}

export function getVerificationSession(taskId: string): SessionRow | undefined {
  return rawGet<SessionRow>(
    "SELECT * FROM verification_sessions WHERE task_id = ?",
    [taskId]
  );
}

export function getSelectedValidators(taskId: string): string[] {
  const session = getVerificationSession(taskId);
  if (!session) return selectValidators(taskId);
  return JSON.parse(session.selected_validators);
}

export function castVote(
  taskId: string,
  validatorId: string,
  passed: boolean
): VerificationVote {
  // Check if validator is selected
  const selectedValidators = getSelectedValidators(taskId);
  if (!selectedValidators.includes(validatorId)) {
    throw new ValidatorNotSelectedError(validatorId, taskId);
  }

  const now = new Date().toISOString();

  // Check if vote already exists
  const existing = rawGet<VoteRow>(
    "SELECT * FROM verification_votes WHERE task_id = ? AND validator_id = ?",
    [taskId, validatorId]
  );

  if (existing) {
    // Update existing vote
    rawRun(
      "UPDATE verification_votes SET passed = ? WHERE task_id = ? AND validator_id = ?",
      [passed ? 1 : 0, taskId, validatorId]
    );
    return {
      id: existing.id,
      taskId,
      validatorId,
      passed,
      createdAt: existing.created_at,
    };
  }

  // Insert new vote
  const id = generateId("vote_");
  rawRun(
    "INSERT INTO verification_votes (id, task_id, validator_id, passed, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, taskId, validatorId, passed ? 1 : 0, now]
  );

  return { id, taskId, validatorId, passed, createdAt: now };
}

export function getVotes(taskId: string): VerificationVote[] {
  const rows = rawAll<VoteRow>(
    "SELECT * FROM verification_votes WHERE task_id = ?",
    [taskId]
  );
  return rows.map(mapVote);
}

export function tallyVotes(taskId: string): ConsensusOutcome | null {
  const votes = getVotes(taskId);
  const selectedValidators = getSelectedValidators(taskId);

  // Need all selected validators to have voted
  if (votes.length < selectedValidators.length) {
    return null;
  }

  const passed = votes.filter((v) => v.passed).length;
  const failed = votes.filter((v) => !v.passed).length;

  const consensusPassed = passed > failed;
  const qualityScore = passed / (passed + failed);

  return {
    passed: consensusPassed,
    qualityScore,
    voteSummary: { passed, failed },
  };
}

export function identifyDissenters(taskId: string, consensusPassed: boolean): string[] {
  const votes = getVotes(taskId);
  return votes
    .filter((v) => v.passed !== consensusPassed)
    .map((v) => v.validatorId);
}

// ---------------------------------------------------------------------------
// 3+1 Aggregation
// ---------------------------------------------------------------------------

interface AggregationRow {
  task_id: string;
  aggregator_id: string;
  blind_votes: string;
  outcome: string | null;
  created_at: string;
}

/**
 * Generate a blind ID for a validator vote.
 * Uses SHA-256(taskId + validatorId) so the aggregator cannot reverse-engineer who voted.
 */
function blindId(taskId: string, validatorId: string): string {
  return createHash("sha256").update(taskId + validatorId).digest("base64url").slice(0, 16);
}

/**
 * Select the 4th validator (aggregator) from remaining validators.
 * Excludes the 3 validators who already voted.
 */
export function selectAggregator(taskId: string): string {
  const selectedValidators = getSelectedValidators(taskId);
  const validators = listValidators();
  const available = validators.filter((v) => !selectedValidators.includes(v.id));

  if (available.length === 0) {
    // Fallback: use one of the selected validators (shouldn't happen in normal flow)
    return selectedValidators[0];
  }

  // Deterministic selection based on task hash
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = (hash * 37 + taskId.charCodeAt(i)) & 0x7fffffff;
  }

  const sorted = [...available].sort((a, b) => {
    const hashA = (hash * 37 + a.id.charCodeAt(0)) & 0x7fffffff;
    const hashB = (hash * 37 + b.id.charCodeAt(0)) & 0x7fffffff;
    return hashA - hashB;
  });

  return sorted[0].id;
}

/**
 * Check if all selected validators have voted.
 */
export function allVotesIn(taskId: string): boolean {
  const votes = getVotes(taskId);
  const selectedValidators = getSelectedValidators(taskId);
  return votes.length >= selectedValidators.length;
}

/**
 * Start the aggregation phase.
 * Called after all 3 validators have voted.
 * Selects aggregator, creates blind votes, transitions task to aggregating.
 */
export function startAggregation(taskId: string): { aggregatorId: string; blindVotes: BlindVote[] } {
  const votes = getVotes(taskId);
  const aggregatorId = selectAggregator(taskId);
  const now = new Date().toISOString();

  // Create blind votes (validator IDs are hashed)
  const blindVotes: BlindVote[] = votes.map((v) => ({
    blindId: blindId(taskId, v.validatorId),
    passed: v.passed,
  }));

  // Save aggregator to verification_sessions
  rawRun(
    "UPDATE verification_sessions SET aggregator_id = ? WHERE task_id = ?",
    [aggregatorId, taskId]
  );

  // Create aggregation session
  rawRun(
    `INSERT OR REPLACE INTO aggregation_sessions (task_id, aggregator_id, blind_votes, outcome, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [taskId, aggregatorId, JSON.stringify(blindVotes), null, now]
  );

  return { aggregatorId, blindVotes };
}

/**
 * Get blind votes for an aggregation session.
 * Returns null if no aggregation session exists.
 */
export function getBlindVotes(taskId: string): BlindVote[] | null {
  const row = rawGet<AggregationRow>(
    "SELECT * FROM aggregation_sessions WHERE task_id = ?",
    [taskId]
  );
  if (!row) return null;
  return JSON.parse(row.blind_votes);
}

/**
 * Get the aggregator for a task.
 */
export function getAggregator(taskId: string): string | null {
  const session = getVerificationSession(taskId);
  if (!session) return null;
  // Check aggregation_sessions for the aggregator
  const row = rawGet<AggregationRow>(
    "SELECT aggregator_id FROM aggregation_sessions WHERE task_id = ?",
    [taskId]
  );
  return row?.aggregator_id ?? null;
}

/**
 * Submit aggregation result.
 * The aggregator tallies the blind votes and determines consensus.
 */
export function submitAggregation(
  taskId: string,
  aggregatorId: string,
): ConsensusOutcome {
  // Verify this validator is the aggregator
  const storedAggregator = getAggregator(taskId);
  if (storedAggregator !== aggregatorId) {
    throw new NotAggregatorError(aggregatorId, taskId);
  }

  const blindVotes = getBlindVotes(taskId);
  if (!blindVotes) {
    throw new TalkenError("No aggregation session found", ErrorCodes.TASK_NOT_FOUND, 404);
  }

  // Tally blind votes
  const passed = blindVotes.filter((v) => v.passed).length;
  const failed = blindVotes.filter((v) => !v.passed).length;
  const consensusPassed = passed > failed;
  const qualityScore = passed / (passed + failed);

  const outcome: ConsensusOutcome = {
    passed: consensusPassed,
    qualityScore,
    voteSummary: { passed, failed },
  };

  // Store outcome
  const now = new Date().toISOString();
  rawRun(
    "UPDATE aggregation_sessions SET outcome = ? WHERE task_id = ?",
    [JSON.stringify(outcome), taskId]
  );

  return outcome;
}

// ---------------------------------------------------------------------------
// Commit-Reveal Anti-Cheat
// ---------------------------------------------------------------------------

/**
 * Phase 1: Validator commits a vote hash.
 * voteHash = SHA-256(taskId + validatorId + passed + secret)
 */
export function commitVote(
  taskId: string,
  validatorId: string,
  voteHash: string
): void {
  // Check if validator is selected
  const selectedValidators = getSelectedValidators(taskId);
  if (!selectedValidators.includes(validatorId)) {
    throw new ValidatorNotSelectedError(validatorId, taskId);
  }

  // Check if already committed
  const existing = rawGet<{ id: string }>(
    "SELECT id FROM commit_votes WHERE task_id = ? AND validator_id = ?",
    [taskId, validatorId]
  );
  if (existing) {
    throw new TalkenError(`Validator ${validatorId} already committed for task ${taskId}`, ErrorCodes.ALREADY_COMMITTED, 409);
  }

  const id = generateId("commit_");
  const now = new Date().toISOString();
  rawRun(
    "INSERT INTO commit_votes (id, task_id, validator_id, vote_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, taskId, validatorId, voteHash, now]
  );
}

/**
 * Check if all selected validators have committed.
 */
export function allCommitsIn(taskId: string): boolean {
  const selectedValidators = getSelectedValidators(taskId);
  const commits = rawAll<{ id: string }>(
    "SELECT id FROM commit_votes WHERE task_id = ?",
    [taskId]
  );
  return commits.length >= selectedValidators.length;
}

/**
 * Get commit votes for a task.
 */
export function getCommitVotes(taskId: string): Array<{ validatorId: string; voteHash: string }> {
  const rows = rawAll<{ validator_id: string; vote_hash: string }>(
    "SELECT validator_id, vote_hash FROM commit_votes WHERE task_id = ?",
    [taskId]
  );
  return rows.map((r) => ({ validatorId: r.validator_id, voteHash: r.vote_hash }));
}

/**
 * Phase 2: Validator reveals their vote.
 * Verifies that SHA-256(taskId + validatorId + passed + secret) matches the committed hash.
 */
export function revealVote(
  taskId: string,
  validatorId: string,
  passed: boolean,
  secret: string
): void {
  // Check if validator committed
  const commit = rawGet<{ vote_hash: string }>(
    "SELECT vote_hash FROM commit_votes WHERE task_id = ? AND validator_id = ?",
    [taskId, validatorId]
  );
  if (!commit) {
    throw new TalkenError(`No commit found for validator ${validatorId} on task ${taskId}`, ErrorCodes.NO_COMMIT_FOUND, 404);
  }

  // Check if already revealed
  const existing = rawGet<{ id: string }>(
    "SELECT id FROM reveal_votes WHERE task_id = ? AND validator_id = ?",
    [taskId, validatorId]
  );
  if (existing) {
    throw new TalkenError(`Validator ${validatorId} already revealed for task ${taskId}`, ErrorCodes.ALREADY_REVEALED, 409);
  }

  // Verify hash
  const computedHash = createHash("sha256")
    .update(taskId + validatorId + String(passed) + secret)
    .digest("hex");

  if (computedHash !== commit.vote_hash) {
    throw new TalkenError(`Invalid reveal from validator ${validatorId} for task ${taskId}`, ErrorCodes.INVALID_REVEAL, 400);
  }

  const id = generateId("reveal_");
  const now = new Date().toISOString();
  rawRun(
    "INSERT INTO reveal_votes (id, task_id, validator_id, passed, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, taskId, validatorId, passed ? 1 : 0, secret, now]
  );
}

/**
 * Check if all selected validators have revealed.
 */
export function allRevealsIn(taskId: string): boolean {
  const selectedValidators = getSelectedValidators(taskId);
  const reveals = rawAll<{ id: string }>(
    "SELECT id FROM reveal_votes WHERE task_id = ?",
    [taskId]
  );
  return reveals.length >= selectedValidators.length;
}

/**
 * Get revealed votes for a task (after reveal phase).
 */
export function getRevealedVotes(taskId: string): VerificationVote[] {
  const rows = rawAll<{ id: string; task_id: string; validator_id: string; passed: number; created_at: string }>(
    "SELECT * FROM reveal_votes WHERE task_id = ?",
    [taskId]
  );
  return rows.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    validatorId: r.validator_id,
    passed: Boolean(r.passed),
    createdAt: r.created_at,
  }));
}

/**
 * Check for timed-out verification sessions and handle fallback.
 * Returns a list of task IDs that were cancelled due to max fallbacks exceeded.
 */
export function checkTimedOutVerifications(): string[] {
  const now = new Date().toISOString();
  const cancelledTasks: string[] = [];

  // Find all sessions that have expired and task is still in "submitted" (awaiting votes)
  const expiredSessions = rawAll<SessionRow>(
    `SELECT vs.* FROM verification_sessions vs
     JOIN tasks t ON t.id = vs.task_id
     WHERE vs.expires_at < ? AND t.status = 'submitted'`,
    [now]
  );

  for (const session of expiredSessions) {
    const taskId = session.task_id;
    const selectedValidators: string[] = JSON.parse(session.selected_validators);
    const votes = getVotes(taskId);
    const votedIds = votes.map((v) => v.validatorId);
    const nonVoters = selectedValidators.filter((id) => !votedIds.includes(id));

    // Penalize non-voting validators (timeout penalty: -0.1 from stake)
    for (const validatorId of nonVoters) {
      rawRun(
        "UPDATE agents SET stake_amount = stake_amount - 0.1, updated_at = ? WHERE id = ?",
        [now, validatorId]
      );
    }

    const fallbackCount = session.fallback_count + 1;

    if (fallbackCount > MAX_FALLBACK_COUNT) {
      // Auto-cancel the task
      rawRun(
        "UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?",
        [now, taskId]
      );
      // Clean up session and relay data (terminal state)
      rawRun("DELETE FROM verification_sessions WHERE task_id = ?", [taskId]);
      cleanupRelayData(taskId);
      cancelledTasks.push(taskId);
    } else {
      // Select replacement validators (exclude those who already voted and non-voters)
      const excludeIds = [...votedIds, ...nonVoters];
      // Get task level for proper validator count
      const taskRow = rawGet<{ level: number }>("SELECT level FROM tasks WHERE id = ?", [taskId]);
      const taskLevel = taskRow?.level ?? 2;
      const newValidators = selectValidators(taskId, excludeIds, LEVEL_VALIDATOR_COUNT[taskLevel] ?? VALIDATOR_COUNT);

      if (newValidators.length === 0) {
        // No more validators available — extend the session and wait for non-voters
        // Only cancel if max fallbacks exceeded
        const newExpiresAt = new Date(Date.now() + VERIFICATION_TIMEOUT_MS).toISOString();
        rawRun(
          `UPDATE verification_sessions SET fallback_count = ?, expires_at = ?
           WHERE task_id = ?`,
          [fallbackCount, newExpiresAt, taskId]
        );
      } else {
        // Merge: keep existing voters + add new validators
        const mergedValidators = [...votedIds, ...newValidators];
        const newExpiresAt = new Date(Date.now() + VERIFICATION_TIMEOUT_MS).toISOString();

        rawRun(
          `UPDATE verification_sessions SET selected_validators = ?, fallback_count = ?, expires_at = ?
           WHERE task_id = ?`,
          [JSON.stringify(mergedValidators), fallbackCount, newExpiresAt, taskId]
        );
      }
    }
  }

  return cancelledTasks;
}
