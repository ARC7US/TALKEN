/**
 * Hardware / network requirements check for Validator Node.
 *
 * Requirements:
 * - NAT: Full Cone (required)
 * - Bandwidth: >= 20 Mbps symmetric (required)
 * - Minimum spec: 1 CPU / 1 GB RAM (soft recommendation)
 */

import { cpus, totalmem, freemem } from "os";

export interface HardwareReport {
  cpu_cores: number;
  memory_gb: number;
  free_memory_gb: number;
  passed: boolean;
  issues: string[];
}

export function checkHardware(): HardwareReport {
  const issues: string[] = [];
  const cpuCount = cpus().length;
  const totalMemGB = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
  const freeMemGB = Math.round((freemem() / 1024 ** 3) * 10) / 10;

  // Soft recommendation: 1 CPU / 1 GB
  const warnings: string[] = [];
  if (cpuCount < 1) {
    warnings.push(`建议 1 核以上 (当前 ${cpuCount} 核)`);
  }
  if (totalMemGB < 1) {
    warnings.push(`建议 1GB 以上内存 (当前 ${totalMemGB} GB)`);
  }

  return {
    cpu_cores: cpuCount,
    memory_gb: totalMemGB,
    free_memory_gb: freeMemGB,
    passed: issues.length === 0,
    issues: [...issues, ...warnings],
  };
}

export function formatHardwareReport(report: HardwareReport): string {
  const lines = [
    "节点检测报告:",
    `  CPU: ${report.cpu_cores} 核`,
    `  内存: ${report.memory_gb} GB (可用 ${report.free_memory_gb} GB)`,
    "",
    "网络要求:",
    "  NAT 类型: 需要 Full Cone（或云服务器/公网 IP）",
    "  带宽: >= 20 Mbps 对称",
    "",
    "注意: NAT 类型和带宽需要手动确认。如使用云服务器（AWS/GCP/阿里云等）或 VPS 通常满足要求。",
  ];

  if (report.issues.length > 0) {
    lines.push("", "建议:");
    for (const issue of report.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  lines.push("", "节点基础检测通过 ✓");
  return lines.join("\n");
}
