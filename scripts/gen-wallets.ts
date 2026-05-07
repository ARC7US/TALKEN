/**
 * Generate 8 wallets for TALKEN token allocation.
 * Saves addresses and keys to wallets.json.
 */

import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { writeFileSync } from "fs";

const LABELS = [
  "team",
  "ecosystem",
  "privateSale",
  "publicSale",
  "foundation",
  "liquidity",
  "airdrop",
  "advisors",
];

const wallets: Record<string, { address: string; privateKey: string }> = {};

for (const label of LABELS) {
  const kp = new Ed25519Keypair();
  wallets[label] = {
    address: kp.getPublicKey().toIotaAddress(),
    privateKey: kp.getSecretKey(),
  };
}

writeFileSync("wallets.json", JSON.stringify(wallets, null, 2));

console.log("Generated 8 wallets:\n");
for (const [label, w] of Object.entries(wallets)) {
  console.log(`  ${label.padEnd(12)} ${w.address}`);
}
console.log("\nSaved to wallets.json");
