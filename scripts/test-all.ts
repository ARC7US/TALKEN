import { execSync } from "child_process";

const tests = [
  "scripts/test-matching.ts",
  "scripts/test-relay.ts",
  "scripts/test-split.ts",
  "scripts/test-anti-cheat.ts",
  "scripts/test-signature.ts",
  "scripts/test-timeout.ts",
  "scripts/test-heartbeat.ts",
  "scripts/test-3plus1.ts",
  "scripts/test-blockchain.ts",
  "scripts/test-mcp-plugin.ts",
  "scripts/test-validator-node.ts",
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Running: ${test}`);
  console.log("=".repeat(50));
  try {
    execSync(`npx tsx ${test}`, { stdio: "inherit", cwd: process.cwd() });
    passed++;
  } catch {
    failed++;
  }
}

console.log(`\n${"=".repeat(50)}`);
console.log(`Total: ${passed} passed, ${failed} failed out of ${tests.length}`);
console.log("=".repeat(50));

if (failed > 0) process.exit(1);
