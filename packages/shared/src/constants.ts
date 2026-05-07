export const TaskStatus = {
  PUBLISHED: "published",
  ACCEPTED: "accepted",
  SUBMITTED: "submitted",
  VERIFIED: "verified",
  CONFIRMED: "confirmed",
  SETTLED: "settled",
  EXPIRED: "expired",
  REJECTED: "rejected",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const AgentRole = {
  PUBLISHER: "publisher",
  EXECUTOR: "executor",
  VALIDATOR: "validator",
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const SkillType = {
  SEARCH: "search",
  CODE: "code",
  ANALYZE: "analyze",
  IMAGE: "image",
  TRANSLATE: "translate",
  VERIFY: "verify",
} as const;
export type SkillType = (typeof SkillType)[keyof typeof SkillType];

export const TaskComplexityMap: Record<SkillType, number> = {
  search: 1.0,
  code: 2.0,
  analyze: 1.5,
  image: 2.5,
  translate: 1.0,
  verify: 0.5,
};

export const StakeStatus = {
  ACTIVE: "active",
  UNBONDING: "unbonding",
  WITHDRAWN: "withdrawn",
} as const;
export type StakeStatus = (typeof StakeStatus)[keyof typeof StakeStatus];

export const VALIDATOR_COUNT = 3;
export const VALIDATOR_VOTE_TIMEOUT_SECONDS = 60;

// ── Task Level System ──────────────────────────────────────────────────
export const TaskLevel = {
  LV1: 1,  // Simple search/translate → 1 validator
  LV2: 2,  // Code generation/analysis → 3 validators
  LV3: 3,  // Complex reasoning → 3 validators
  LV4: 4,  // Multi-step collaboration → 5 validators
  LV5: 5,  // High-risk tasks → 7 validators
} as const;
export type TaskLevel = (typeof TaskLevel)[keyof typeof TaskLevel];

/** Number of validators required for each task level */
export const LEVEL_VALIDATOR_COUNT: Record<number, number> = {
  1: 1,
  2: 3,
  3: 3,
  4: 5,
  5: 7,
};

/** Minimum reputation required to execute tasks at each level */
export const LEVEL_MIN_REPUTATION: Record<number, number> = {
  1: 0.0,
  2: 0.3,
  3: 0.5,
  4: 0.7,
  5: 0.9,
};

/** Minimum reputation for an executor to be matched */
export const MIN_REPUTATION_THRESHOLD = 0.1;
export const BASE_MINT_RATE = 0.01;
export const VALIDATOR_FIXED_REWARD = 0.5;
export const SLASH_MULTIPLIER = 2;
export const TOTAL_SUPPLY = 100_000_000; // 100M
export const DECIMALS = 9;

// Token allocation percentages
export const ALLOCATION = {
  TEAM:           0.30,
  ECOSYSTEM:      0.20,
  PRIVATE_SALE:   0.15,
  PUBLIC_SALE:    0.10,
  FOUNDATION:     0.10,
  LIQUIDITY:      0.05,
  AIRDROP:        0.05,
  ADVISORS:       0.05,
} as const;
export const HALVING_EPOCH_YEARS = 4;
export const ANNUAL_INFLATION_CAP = 0.05;

export const ErrorCodes = {
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  INSUFFICIENT_STAKE: "INSUFFICIENT_STAKE",
  UNAUTHORIZED: "UNAUTHORIZED",
  TASK_EXPIRED: "TASK_EXPIRED",
  ALREADY_ACCEPTED: "ALREADY_ACCEPTED",
  NOT_YOUR_TASK: "NOT_YOUR_TASK",
  VERIFICATION_TIMEOUT: "VERIFICATION_TIMEOUT",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  VALIDATOR_NOT_SELECTED: "VALIDATOR_NOT_SELECTED",
  RELAY_DATA_NOT_FOUND: "RELAY_DATA_NOT_FOUND",
  RELAY_ACCESS_DENIED: "RELAY_ACCESS_DENIED",
  NOT_AGGREGATOR: "NOT_AGGREGATOR",
  NO_MATCHING_EXECUTOR: "NO_MATCHING_EXECUTOR",
  ALREADY_COMMITTED: "ALREADY_COMMITTED",
  COMMIT_PHASE_NOT_DONE: "COMMIT_PHASE_NOT_DONE",
  ALREADY_REVEALED: "ALREADY_REVEALED",
  INVALID_REVEAL: "INVALID_REVEAL",
  NO_COMMIT_FOUND: "NO_COMMIT_FOUND",
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
