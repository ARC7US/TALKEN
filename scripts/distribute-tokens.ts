/**
 * TALKEN Token Distribution Script
 *
 * Mints 100M TALKEN and distributes to allocation wallets.
 * Run after deploying the contract to mainnet.
 *
 * Usage:
 *   npx tsx scripts/distribute-tokens.ts
 *
 * Environment variables (set in .env):
 *   TALKEN_CONTRACT_PACKAGE_ID  — Deployed package ID
 *   TREASURY_CAP_ID             — TreasuryCap object ID
 *   ADMIN_CAP_ID                — AdminCap object ID
 *   IOTA_ADMIN_PRIVATE_KEY      — Deployer private key
 *   DISTRIBUTION_MODE           — "testnet" or "mainnet" (default: testnet)
 */

import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { Transaction } from "@iota/iota-sdk/transactions";
import { fromB64 } from "@iota/iota-sdk/utils";

// ── Config ──────────────────────────────────────────────────────────────

const TOTAL_SUPPLY = 100_000_000; // 100M tokens
const DECIMALS = 9;
const TOTAL_SUPPLY_BASE = BigInt(TOTAL_SUPPLY) * BigInt(10 ** DECIMALS);

// Allocation percentages
const ALLOCATION = {
  team:           { pct: 30, label: "团队" },
  ecosystem:      { pct: 20, label: "生态基金" },
  privateSale:    { pct: 15, label: "私募" },
  publicSale:     { pct: 10, label: "公募" },
  foundation:     { pct: 10, label: "基金会金库" },
  liquidity:      { pct: 5,  label: "流动性" },
  airdrop:        { pct: 5,  label: "空投" },
  advisors:       { pct: 5,  label: "顾问" },
} as const;

type AllocationKey = keyof typeof ALLOCATION;

// ── Wallet addresses — REPLACE WITH REAL ADDRESSES ──────────────────────

const WALLETS: Record<AllocationKey, string> = {
  team:        "0x0000000000000000000000000000000000000000000000000000000000000001", // TODO: replace
  ecosystem:   "0x0000000000000000000000000000000000000000000000000000000000000002", // TODO: replace
  privateSale: "0x0000000000000000000000000000000000000000000000000000000000000003", // TODO: replace
  publicSale:  "0x0000000000000000000000000000000000000000000000000000000000000004", // TODO: replace
  foundation:  "0x0000000000000000000000000000000000000000000000000000000000000005", // TODO: replace
  liquidity:   "0x0000000000000000000000000000000000000000000000000000000000000006", // TODO: replace
  airdrop:     "0x0000000000000000000000000000000000000000000000000000000000000007", // TODO: replace
  advisors:    "0x0000000000000000000000000000000000000000000000000000000000000008", // TODO: replace
};

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.env.DISTRIBUTION_MODE ?? "testnet";
  const rpcUrl = getFullnodeUrl(mode as any);
  const pkgId = process.env.TALKEN_CONTRACT_PACKAGE_ID;
  const treasuryCapId = process.env.TREASURY_CAP_ID;
  const adminCapId = process.env.ADMIN_CAP_ID;
  const adminKey = process.env.IOTA_ADMIN_PRIVATE_KEY;

  if (!pkgId || !treasuryCapId || !adminCapId || !adminKey) {
    console.error("Missing env vars. Set TALKEN_CONTRACT_PACKAGE_ID, TREASURY_CAP_ID, ADMIN_CAP_ID, IOTA_ADMIN_PRIVATE_KEY");
    process.exit(1);
  }

  console.log(`Network: ${mode}`);
  console.log(`Package: ${pkgId}`);
  console.log(`Total supply: ${TOTAL_SUPPLY.toLocaleString()} TALKEN (${TOTAL_SUPPLY_BASE.toString()} base units)\n`);

  // Check for placeholder addresses
  const hasPlaceholder = Object.values(WALLETS).some(a => a.includes("000000000000000000000000000000000000000000000000000000000000000"));
  if (hasPlaceholder) {
    console.error("ERROR: WALLETS contains placeholder addresses. Replace them with real addresses before running.");
    console.error("Edit scripts/distribute-tokens.ts and update the WALLETS object.");
    process.exit(1);
  }

  // Init client and keypair
  const client = new IotaClient({ url: rpcUrl });
  const keypair = Ed25519Keypair.fromSecretKey(fromB64(adminKey));
  const adminAddr = keypair.getPublicKey().toIotaAddress();
  console.log(`Admin address: ${adminAddr}\n`);

  // Print allocation table
  console.log("┌─────────────────────────────────────────────────────────┐");
  console.log("│  Token Distribution                                     │");
  console.log("├──────────────┬──────┬──────────────────┬────────────────┤");
  console.log("│ Pool         │  %   │ Amount           │ Address        │");
  console.log("├──────────────┼──────┼──────────────────┼────────────────┤");

  for (const [key, info] of Object.entries(ALLOCATION)) {
    const amount = (TOTAL_SUPPLY_BASE * BigInt(info.pct)) / BigInt(100);
    const amountStr = (Number(amount) / 10 ** DECIMALS).toLocaleString();
    const addr = WALLETS[key as AllocationKey];
    const shortAddr = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    console.log(`│ ${info.label.padEnd(12)} │ ${String(info.pct).padStart(3)}% │ ${amountStr.padStart(16)} │ ${shortAddr} │`);
  }
  console.log("└──────────────┴──────┴──────────────────┴────────────────┘\n");

  // ── Step 1: Mint total supply to admin ──────────────────────────────
  console.log("Step 1: Minting total supply to admin...");

  const mintTx = new Transaction();
  mintTx.moveCall({
    target: `${pkgId}::talken_token::mint`,
    arguments: [
      mintTx.object(adminCapId),
      mintTx.object(treasuryCapId),
      mintTx.pure.address(adminAddr),
      mintTx.pure.u64(TOTAL_SUPPLY_BASE.toString()),
    ],
  });

  const mintResult = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: mintTx,
  });
  await client.waitForTransaction({ digest: mintResult.digest });
  console.log(`  Minted ${TOTAL_SUPPLY.toLocaleString()} TALKEN to admin`);
  console.log(`  TX: ${mintResult.digest}\n`);

  // ── Step 2: Get the minted coin object ──────────────────────────────
  console.log("Step 2: Finding minted coin...");

  const coins = await client.getCoins({
    owner: adminAddr,
    coinType: `${pkgId}::talken_token::TALKEN_TOKEN`,
  });

  if (coins.data.length === 0) {
    console.error("ERROR: No TALKEN coins found after minting");
    process.exit(1);
  }

  // The minted coin should be the largest one
  const mainCoin = coins.data.sort((a, b) => {
    const diff = BigInt(b.balance) - BigInt(a.balance);
    return diff > 0n ? 1 : diff < 0n ? -1 : 0;
  })[0];

  console.log(`  Found coin: ${mainCoin.coinObjectId}`);
  console.log(`  Balance: ${Number(mainCoin.balance) / 10 ** DECIMALS} TALKEN\n`);

  // ── Step 3: Distribute to each allocation pool ─────────────────────
  console.log("Step 3: Distributing tokens...");

  const entries = Object.entries(ALLOCATION);
  const coinObjectId = mainCoin.coinObjectId;

  for (let i = 0; i < entries.length; i++) {
    const [key, info] = entries[i];
    const addr = WALLETS[key as AllocationKey];
    const amount = (TOTAL_SUPPLY_BASE * BigInt(info.pct)) / BigInt(100);

    const tx = new Transaction();

    // Use split_and_transfer from our contract
    tx.moveCall({
      target: `${pkgId}::talken_token::split_and_transfer`,
      arguments: [
        tx.object(coinObjectId),
        tx.pure.u64(amount.toString()),
        tx.pure.address(addr),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    await client.waitForTransaction({ digest: result.digest });

    const amountStr = (Number(amount) / 10 ** DECIMALS).toLocaleString();
    console.log(`  ✓ ${info.label}: ${amountStr} TALKEN → ${addr.slice(0, 10)}...`);
  }

  // ── Done ────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  Distribution complete!                       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`\nTotal distributed: ${TOTAL_SUPPLY.toLocaleString()} TALKEN`);
  console.log(`Network: ${mode}`);
  console.log("\nNext steps:");
  console.log("  1. Verify balances: npx tsx scripts/check-tokens.ts");
  console.log("  2. Set up vesting contracts for team/advisors");
  console.log("  3. Add liquidity on DEX");
}

main().catch((err) => {
  console.error("Distribution failed:", err);
  process.exit(1);
});
