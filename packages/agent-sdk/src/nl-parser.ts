import type { AgentRole } from "./client.js";

interface IntentPattern {
  pattern: RegExp;
  intent: "switch_role" | "publish_task" | "accept_task" | "check_balance" | "list_tasks" | "vote" | "unknown";
  role?: AgentRole;
  extract?: (match: RegExpMatchArray) => Record<string, string>;
}

const PATTERNS: IntentPattern[] = [
  // Role switching
  { pattern: /接单|赚钱|executor|执行任务|作为executor|切换.*executor|become.*executor|start.*earning/i, intent: "switch_role", role: "executor" },
  { pattern: /发布.*任务|发任务|publisher|委托|发布任务|publish.*task|create.*task|作为publisher/i, intent: "switch_role", role: "publisher" },
  { pattern: /验证|validator|审核|做验证者|become.*validator|start.*validating/i, intent: "switch_role", role: "validator" },

  // Publish task
  { pattern: /发布.*搜索|搜索.*任务|search.*task/i, intent: "publish_task", extract: (m) => ({ skill: "search", description: m[0] }) },
  { pattern: /发布.*代码|代码.*任务|code.*task/i, intent: "publish_task", extract: (m) => ({ skill: "code", description: m[0] }) },
  { pattern: /发布.*分析|分析.*任务|analyze.*task/i, intent: "publish_task", extract: (m) => ({ skill: "analyze", description: m[0] }) },
  { pattern: /发布.*翻译|翻译.*任务|translate.*task/i, intent: "publish_task", extract: (m) => ({ skill: "translate", description: m[0] }) },

  // Accept task
  { pattern: /接.*任务|接受.*任务|accept.*task|take.*task/i, intent: "accept_task" },

  // Check balance
  { pattern: /余额|balance|赚了多少|收益|earnings|查看.*钱包/i, intent: "check_balance" },

  // List tasks
  { pattern: /任务列表|有什么任务|查看任务|list.*tasks|my.*tasks|show.*tasks/i, intent: "list_tasks" },

  // Vote
  { pattern: /投票|通过|不通过|vote.*pass|vote.*fail/i, intent: "vote" },
];

export interface ParsedIntent {
  intent: IntentPattern["intent"];
  role?: AgentRole;
  params?: Record<string, string>;
  raw: string;
}

/**
 * Parse natural language input to determine user intent.
 * Supports both Chinese and English.
 *
 * Examples:
 * - "现在在talken平台上作为executor来接取订单为我赚钱" → { intent: "switch_role", role: "executor" }
 * - "切换到发布者模式" → { intent: "switch_role", role: "publisher" }
 * - "查看余额" → { intent: "check_balance" }
 * - "发布一个搜索任务" → { intent: "publish_task", params: { skill: "search" } }
 */
export function parseIntent(input: string): ParsedIntent {
  const trimmed = input.trim();

  for (const { pattern, intent, role, extract } of PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        intent,
        role,
        params: extract ? extract(match) : undefined,
        raw: trimmed,
      };
    }
  }

  return { intent: "unknown", raw: trimmed };
}

/**
 * Extract fee amount from natural language.
 * "发布任务费用10" → 10
 * "fee 10 TALKEN" → 10
 * "费用 5.5" → 5.5
 */
export function extractFee(input: string): number | null {
  const match = input.match(/(?:费用|fee|价格|cost)\s*[:：]?\s*(\d+\.?\d*)/i);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Extract task description from natural language.
 * "帮我搜索关于AI的最新论文" → "搜索关于AI的最新论文"
 */
export function extractDescription(input: string): string | null {
  // Remove common prefixes
  const cleaned = input
    .replace(/^(帮我|请|帮忙|please|help\s+me)\s*/i, "")
    .replace(/^(发布|发|创建|create|publish)\s*(一个?|a|an)?\s*/i, "")
    .replace(/^(搜索|代码|分析|翻译|search|code|analyze|translate)\s*(任务|task)?\s*/i, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
