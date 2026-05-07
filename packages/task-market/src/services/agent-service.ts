import { rawRun, rawGet, rawAll } from "../db/connection.js";
import { AgentNotFoundError } from "@talken/shared";
import type { Agent, AgentPublicProfile } from "@talken/shared";

interface AgentRow {
  id: string;
  name: string;
  skills: string;
  public_key: string | null;
  stake_amount: number;
  reputation: number;
  balance: number;
  created_at: string;
  updated_at: string;
}

function mapAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    skills: JSON.parse(row.skills) as string[],
    stakeAmount: row.stake_amount,
    reputation: row.reputation,
    balance: row.balance,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function registerAgent(
  id: string,
  name: string,
  skills: string[],
  publicKey?: string,
): Agent {
  const now = new Date().toISOString();
  // INSERT OR IGNORE: don't overwrite existing agents (preserves balance, stake, etc.)
  // If public key is provided and agent exists, update the public key
  const existing = getAgent(id);
  if (existing) {
    if (publicKey) {
      rawRun("UPDATE agents SET public_key = ?, updated_at = ? WHERE id = ?", [publicKey, now, id]);
    }
    return getAgentOrThrow(id);
  }
  rawRun(
    `INSERT INTO agents (id, name, skills, public_key, stake_amount, reputation, balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, JSON.stringify(skills), publicKey ?? null, 0, 1.0, 0, now, now],
  );
  return getAgentOrThrow(id);
}

export function getAgent(id: string): Agent | undefined {
  const row = rawGet<AgentRow>("SELECT * FROM agents WHERE id = ?", [id]);
  return row ? mapAgent(row) : undefined;
}

export function getAgentOrThrow(id: string): Agent {
  const agent = getAgent(id);
  if (!agent) throw new AgentNotFoundError(id);
  return agent;
}

/** Get the agent's registered public key (for signature verification) */
export function getAgentPublicKey(id: string): string | null {
  const row = rawGet<{ public_key: string | null }>(
    "SELECT public_key FROM agents WHERE id = ?",
    [id],
  );
  return row?.public_key ?? null;
}

export function updateAgentBalance(id: string, balance: number): void {
  const now = new Date().toISOString();
  rawRun("UPDATE agents SET balance = ?, updated_at = ? WHERE id = ?", [balance, now, id]);
}

export function updateAgentStake(id: string, stakeAmount: number): void {
  const now = new Date().toISOString();
  rawRun("UPDATE agents SET stake_amount = ?, updated_at = ? WHERE id = ?", [stakeAmount, now, id]);
}

export function updateAgentReputation(id: string, reputation: number): void {
  const now = new Date().toISOString();
  rawRun("UPDATE agents SET reputation = ?, updated_at = ? WHERE id = ?", [reputation, now, id]);
}

export function listValidators(): Agent[] {
  const rows = rawAll<AgentRow>("SELECT * FROM agents WHERE stake_amount > 0");
  return rows.map(mapAgent);
}

export function getAgentPublicProfile(id: string): AgentPublicProfile {
  const agent = getAgentOrThrow(id);

  const completedRow = rawGet<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM tasks WHERE executor_id = ? AND status = 'settled'",
    [id],
  );
  const publishedRow = rawGet<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM tasks WHERE publisher_id = ?",
    [id],
  );
  const validationRow = rawGet<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM verification_votes WHERE validator_id = ?",
    [id],
  );

  return {
    id: agent.id,
    name: agent.name,
    skills: agent.skills,
    reputation: agent.reputation,
    stakeAmount: agent.stakeAmount,
    completedTasks: completedRow?.cnt ?? 0,
    publishedTasks: publishedRow?.cnt ?? 0,
    validationCount: validationRow?.cnt ?? 0,
  };
}

export function listAgents(): Agent[] {
  const rows = rawAll<AgentRow>("SELECT * FROM agents");
  return rows.map(mapAgent);
}
