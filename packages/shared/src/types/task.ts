import type { VerificationVote } from "./verification.js";
import type { Settlement } from "./settlement.js";

export interface TaskParams {
  query?: string;
  engine?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  codeContext?: string;
  [key: string]: unknown;
}

export interface TaskResult {
  content: string;
  tokensUsed?: number;
  sources?: string[];
  [key: string]: unknown;
}

export interface Task {
  id: string;
  publisherId: string;
  executorId: string | null;
  skill: string;
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  complexity: number;
  level: number;
  parentTaskId: string | null;
  depth: number;
  fee: number;
  status: string;
  ttl: number;
  signature: string;
  qualityScore: number | null;
  consensusResult: boolean | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  verificationVotes?: VerificationVote[];
  settlement?: Settlement;
}
