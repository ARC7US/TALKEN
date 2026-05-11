/**
 * Standalone hardware check — runs with plain `node`.
 * Checks CPU/MEM as soft recommendation, NAT/bandwidth noted for manual check.
 */

import { cpus, totalmem, freemem } from "os";

const cpuCount = cpus().length;
const totalMemGB = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
const freeMemGB = Math.round((freemem() / 1024 ** 3) * 10) / 10;

const ok = cpuCount >= 1 && totalMemGB >= 1;

console.log("节点检测报告:");
console.log(`  CPU: ${cpuCount} 核`);
console.log(`  内存: ${totalMemGB} GB (可用 ${freeMemGB} GB)`);
console.log("");
console.log("网络要求:");
console.log("  NAT 类型: 需要 Full Cone（或云服务器/公网 IP）");
console.log("  带宽: >= 20 Mbps 对称");
console.log("");
console.log("注意: NAT 类型和带宽需要手动确认。如使用云服务器（VPS）通常满足要求。");

if (!ok) {
  console.log("\n建议:");
  if (cpuCount < 1) console.log("  - 建议 1 核以上 CPU");
  if (totalMemGB < 1) console.log("  - 建议 1GB 以上内存");
  console.log("\n硬件可能不足，节点可能运行不稳定。");
} else {
  console.log("\n基础硬件满足最低要求 ✓");
}
