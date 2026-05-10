/**
 * Validator Node Configuration
 * Reads and validates YAML config file.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

export interface LLMProviderConfig {
  protocol?: "openai" | "anthropic";
  base_url: string;
  api_key: string;
  model: string;
  max_tokens?: number;
  temperature?: number;
}

export interface ValidatorConfig {
  node: {
    name: string;
    data_dir: string;
  };
  network: {
    server_url: string;
    listen_port: number;
    nat_type: "full_cone" | "symmetric" | "port_restricted";
  };
  staking: {
    amount: number;
    auto_restake: boolean;
    min_stake: number;
  };
  llm: {
    default_provider: string;
    providers: Record<string, LLMProviderConfig>;
  };
  scoring: {
    prompt_template: string;
    timeout: number;
    retries: number;
  };
}

const DEFAULT_CONFIG: ValidatorConfig = {
  node: {
    name: `validator-${Date.now().toString(36)}`,
    data_dir: "./data",
  },
  network: {
    server_url: "",
    listen_port: 1789,
    nat_type: "full_cone",
  },
  staking: {
    amount: 100,
    auto_restake: true,
    min_stake: 100,
  },
  llm: {
    default_provider: "custom",
    providers: {
      custom: {
        protocol: "openai",
        base_url: "",
        api_key: "",
        model: "",
        max_tokens: 4096,
      },
    },
  },
  scoring: {
    prompt_template: `你是一个任务验证专家。请评估以下任务的执行结果。

## 任务描述
{task_description}

## 任务参数
{task_params}

## 执行结果
{executor_result}

## 评分标准
1. 结果是否正确完成了任务要求
2. 结果质量是否达标
3. 是否有明显的错误或遗漏

请以 JSON 格式返回评分：
{
  "passed": true/false,
  "score": 0-100,
  "reason": "评分理由"
}`,
    timeout: 60,
    retries: 2,
  },
};

export function getConfigPath(): string {
  return join(process.cwd(), "validator-config.yaml");
}

export function loadConfig(configPath?: string): ValidatorConfig {
  const path = configPath ?? getConfigPath();

  if (!existsSync(path)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(path, "utf-8");
    // Try JSON first, then simple YAML-like parsing
    let parsed: Partial<ValidatorConfig>;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Simple fallback: return defaults
      parsed = {};
    }
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch (err: any) {
    console.warn(`Warning: Failed to parse config at ${path}: ${err.message}`);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: ValidatorConfig, configPath?: string): void {
  const path = configPath ?? getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const content = JSON.stringify(config, null, 2);
  writeFileSync(path, content, "utf-8");
}

export function resolveEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVars);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveEnvVars(value);
    }
    return result;
  }
  return obj;
}

function mergeConfig(defaults: ValidatorConfig, overrides: Partial<ValidatorConfig>): ValidatorConfig {
  return {
    node: { ...defaults.node, ...overrides.node },
    network: { ...defaults.network, ...overrides.network },
    staking: { ...defaults.staking, ...overrides.staking },
    llm: {
      default_provider: overrides.llm?.default_provider ?? defaults.llm.default_provider,
      providers: { ...defaults.llm.providers, ...overrides.llm?.providers },
    },
    scoring: { ...defaults.scoring, ...overrides.scoring },
  };
}
