/**
 * Scoring Engine
 * Uses LLM to evaluate task results and produce a pass/fail verdict.
 */

import type { ValidatorConfig } from "./config.js";
import { callLLM, parseScoringResult, type ScoringResult } from "./llm-provider.js";

export interface TaskToScore {
  taskId: string;
  skill: string;
  description: string;
  params: Record<string, unknown>;
  executorResult: string;
}

/**
 * Build the scoring prompt from template and task data.
 */
function buildPrompt(template: string, task: TaskToScore): string {
  return template
    .replace("{task_description}", task.description)
    .replace("{task_params}", JSON.stringify(task.params, null, 2))
    .replace("{executor_result}", task.executorResult);
}

/**
 * Score a task result using the configured LLM provider.
 * Retries on failure up to configured number of times.
 */
export async function scoreTask(config: ValidatorConfig, task: TaskToScore): Promise<ScoringResult> {
  const providerConfig = config.llm.providers[config.llm.default_provider];
  if (!providerConfig) {
    throw new Error(`LLM provider not found: ${config.llm.default_provider}`);
  }

  if (!providerConfig.api_key) {
    throw new Error(`API key not configured for provider: ${config.llm.default_provider}`);
  }

  const prompt = buildPrompt(config.scoring.prompt_template, task);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= config.scoring.retries; attempt++) {
    try {
      const response = await callLLM(providerConfig, prompt);
      return parseScoringResult(response.content);
    } catch (err: any) {
      lastError = err;
      if (attempt < config.scoring.retries) {
        // Wait before retry (exponential backoff)
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(`Scoring failed after ${config.scoring.retries + 1} attempts: ${lastError?.message}`);
}

/**
 * Format a scoring result for display.
 */
export function formatScoringResult(result: ScoringResult): string {
  return [
    `评分结果: ${result.passed ? "通过 ✓" : "不通过 ✗"}`,
    `分数: ${result.score}/100`,
    `理由: ${result.reason}`,
  ].join("\n");
}
