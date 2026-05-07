import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  publisherId: text("publisher_id").notNull(),
  executorId: text("executor_id"),
  skill: text("skill").notNull(),
  params: text("params", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  result: text("result", { mode: "json" }).$type<Record<string, unknown>>(),
  complexity: real("complexity").notNull(),
  fee: real("fee").notNull(),
  status: text("status").notNull().default("published"),
  ttl: integer("ttl").notNull(),
  signature: text("signature").notNull(),
  qualityScore: real("quality_score"),
  consensusResult: integer("consensus_result", { mode: "boolean" }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  skills: text("skills", { mode: "json" }).notNull().$type<string[]>(),
  publicKey: text("public_key"),
  stakeAmount: real("stake_amount").notNull().default(0),
  reputation: real("reputation").notNull().default(1.0),
  balance: real("balance").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const verificationVotes = sqliteTable("verification_votes", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  validatorId: text("validator_id").notNull(),
  passed: integer("passed", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

export const settlements = sqliteTable("settlements", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  publisherId: text("publisher_id").notNull(),
  executorId: text("executor_id").notNull(),
  feeTransfer: real("fee_transfer").notNull(),
  mintReward: real("mint_reward").notNull(),
  validatorRewards: text("validator_rewards", { mode: "json" }).notNull().$type<Record<string, number>>(),
  txHash: text("tx_hash").notNull(),
  settledAt: text("settled_at").notNull(),
});

export const stakes = sqliteTable("stakes", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  unbondedAt: text("unbonded_at"),
});
