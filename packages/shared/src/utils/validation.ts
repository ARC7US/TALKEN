import { z } from "zod";
import { SkillType, TaskStatus, StakeStatus } from "../constants.js";

export const TaskParamsSchema = z.object({
  query: z.string().optional(),
  engine: z.string().optional(),
  sourceLanguage: z.string().optional(),
  targetLanguage: z.string().optional(),
  codeContext: z.string().optional(),
}).passthrough();

export const TaskResultSchema = z.object({
  content: z.string(),
  tokensUsed: z.number().optional(),
  sources: z.array(z.string()).optional(),
}).passthrough();

export const PublishTaskSchema = z.object({
  skill: z.enum(Object.values(SkillType) as [string, ...string[]]),
  params: TaskParamsSchema,
  complexity: z.number().min(0.1).max(10).default(1.0),
  fee: z.number().min(0.01),
  ttl: z.number().min(10).max(3600).default(300),
});

export const SubmitResultSchema = z.object({
  result: TaskResultSchema,
});

export const VerificationVoteSchema = z.object({
  passed: z.boolean(),
});

export const AgentRegisterSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  skills: z.array(z.enum(Object.values(SkillType) as [string, ...string[]])).min(1),
  publicKey: z.string().optional(),
  signature: z.string().optional(),
});

export const StakeSchema = z.object({
  amount: z.number().min(1),
});

export const ConfirmRejectSchema = z.object({
  reason: z.string().max(500).optional(),
});

export type PublishTaskInput = z.infer<typeof PublishTaskSchema>;
export type SubmitResultInput = z.infer<typeof SubmitResultSchema>;
export type VerificationVoteInput = z.infer<typeof VerificationVoteSchema>;
export type AgentRegisterInput = z.infer<typeof AgentRegisterSchema>;
export type StakeInput = z.infer<typeof StakeSchema>;
