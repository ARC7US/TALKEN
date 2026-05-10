/**
 * Standalone hardware check — runs with plain `node`.
 */

import { cpus, totalmem, freemem } from "os";

const issues = [];
const cpuCount = cpus().length;
const totalMemGB = totalmem() / 1024 ** 3;
const freeMemGB = freemem() / 1024 ** 3;

if (cpuCount < 4) {
  issues.push(`CPU 核心不足: ${cpuCount}/4 (最低要求 4 核)`);
}
if (totalMemGB < 4) {
  issues.push(`内存不足: ${totalMemGB.toFixed(1)}GB/4GB (最低要求 4GB)`);
}

console.log("硬件检测报告:");
console.log(`  CPU: ${cpuCount} 核 ${cpuCount >= 4 ? "✓" : "✗"}`);
console.log(`  内存: ${totalMemGB.toFixed(1)} GB (可用 ${freeMemGB.toFixed(1)} GB) ${totalMemGB >= 4 ? "✓" : "✗"}`);

if (issues.length > 0) {
  console.log("\n问题:");
  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }
  console.log("\n硬件检测未通过 ✗");
  process.exit(1);
} else {
  console.log("\n硬件检测通过 ✓");
}
