/**
 * Hardware requirements check for Validator Node.
 *
 * Minimum requirements:
 * - CPU: 4 cores
 * - Memory: 4 GB
 * - Bandwidth: 20 Mbps symmetric
 * - NAT: Full Cone
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

  // CPU check
  const cpuCount = cpus().length;
  if (cpuCount < 4) {
    issues.push(`CPU 核心不足: ${cpuCount}/4 (最低要求 4 核)`);
  }

  // Memory check
  const totalMemGB = totalmem() / 1024 ** 3;
  const freeMemGB = freemem() / 1024 ** 3;
  if (totalMemGB < 4) {
    issues.push(`内存不足: ${totalMemGB.toFixed(1)}GB/4GB (最低要求 4GB)`);
  }

  return {
    cpu_cores: cpuCount,
    memory_gb: Math.round(totalMemGB * 10) / 10,
    free_memory_gb: Math.round(freeMemGB * 10) / 10,
    passed: issues.length === 0,
    issues,
  };
}

export function formatHardwareReport(report: HardwareReport): string {
  const lines = [
    "硬件检测报告:",
    `  CPU: ${report.cpu_cores} 核 ${report.cpu_cores >= 4 ? "✓" : "✗"}`,
    `  内存: ${report.memory_gb} GB (可用 ${report.free_memory_gb} GB) ${report.memory_gb >= 4 ? "✓" : "✗"}`,
  ];

  if (report.issues.length > 0) {
    lines.push("", "问题:");
    for (const issue of report.issues) {
      lines.push(`  - ${issue}`);
    }
  }

  lines.push("", report.passed ? "硬件检测通过 ✓" : "硬件检测未通过 ✗");
  return lines.join("\n");
}
