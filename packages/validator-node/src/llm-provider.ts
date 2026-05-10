/**
 * LLM Provider Adapter
 * Supports OpenAI-compatible APIs (OpenAI, DeepSeek, custom)
 * and Anthropic API.
 */

import type { LLMProviderConfig } from "./config.js";

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface ScoringResult {
  passed: boolean;
  score: number;
  reason: string;
}

/**
 * Call an OpenAI-compatible API (OpenAI, DeepSeek, Ollama, etc.)
 */
async function callOpenAI(config: LLMProviderConfig, prompt: string): Promise<LLMResponse> {
  const url = `${config.base_url.replace(/\/$/, "")}/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: config.max_tokens ?? 4096,
      temperature: config.temperature ?? 0.1,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage,
  };
}

/**
 * Call the Anthropic API
 */
async function callAnthropic(config: LLMProviderConfig, prompt: string): Promise<LLMResponse> {
  const url = `${config.base_url.replace(/\/$/, "")}/v1/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.api_key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: config.max_tokens ?? 4096,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  return {
    content: data.content?.[0]?.text ?? "",
    usage: data.usage,
  };
}

/**
 * Call LLM based on provider type.
 * Uses explicit `protocol` field if set, otherwise auto-detects from base_url.
 */
export async function callLLM(config: LLMProviderConfig, prompt: string): Promise<LLMResponse> {
  const isAnthropic = config.protocol === "anthropic"
    || (!config.protocol && (config.base_url.includes("anthropic") || config.base_url.includes("claude")));

  if (isAnthropic) {
    return callAnthropic(config, prompt);
  }
  return callOpenAI(config, prompt);
}

/**
 * Parse a scoring result from LLM response JSON.
 */
export function parseScoringResult(content: string): ScoringResult {
  // Try to extract JSON from the response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Failed to parse scoring result: no JSON found in response`);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    if (typeof parsed.passed !== "boolean") {
      throw new Error("Missing or invalid 'passed' field");
    }
    if (typeof parsed.score !== "number") {
      throw new Error("Missing or invalid 'score' field");
    }
    if (typeof parsed.reason !== "string") {
      throw new Error("Missing or invalid 'reason' field");
    }

    return {
      passed: parsed.passed,
      score: Math.max(0, Math.min(100, parsed.score)),
      reason: parsed.reason,
    };
  } catch (err: any) {
    throw new Error(`Failed to parse scoring JSON: ${err.message}`);
  }
}
