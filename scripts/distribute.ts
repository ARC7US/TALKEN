/**
 * Distribute 100M TALKEN to 8 allocation wallets.
 * Reads wallet addresses from wallets.json.
 *
 * Usage: tsx scripts/distribute.ts
 */

import { Ed25519Keypair } from "@iota/iota-sdk/keypairs/ed25519";
import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";
import { Transaction } from "@iota/iota-sdk/transactions";
import { readFileSync } from "fs";

// Load .env
try {
  const env = readFileSync(".env", "utf-8");
  for (const line of env.split("\n")) {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
  }
} catch {}

const DECIMALS = 9;
const TOTAL = 100_000_000n * BigInt(10 ** DECIMALS);

const ALLOCATION: Record<string, { pct: number; label: string }> = {
  team:        { pct: 30, label: "团队" },
  ecosystem:   { pct: 20, label: "生态基金" },
  privateSale: { pct: 15, label: "私募" },
  publicSale:  { pct: 10, label: "公募" },
  foundation:  { pct: 10, label: "基金会金库" },
  liquidity:   { pct: 5,  label: "流动性" },
  airdrop:     { pct: 5,  label: "空投" },
  advisors:    { pct: 5,  label: "顾问" },
};

async function main() {
  const pkgId = process.env.TALKEN_CONTRACT_PACKAGE_ID!;
  const adminKey = process.env.IOTA_ADMIN_PRIVATE_KEY!;

  // Load wallets
  const wallets: Record<string, { address: string }> = JSON.parse(
    readFileSync("wallets.json", "utf-8")
  );

  const mode = process.env.STELLAR_MODE ?? "testnet";
  const rpcUrl = mode === "mock"
    ? "https://api.testnet.iota.cafe"
    : `https://api.${mode}.iota.cafe`;
  const client = new IotaClient({ url: rpcUrl });
  const keypair = Ed25519Keypair.fromSecretKey(adminKey);
  const adminAddr = keypair.getPublicKey().toIotaAddress();

  // Find the TALKEN coin (largest balance)
  const coins = await client.getCoins({
    owner: adminAddr,
    coinType: `${pkgId}::talken_token::TALKEN_TOKEN`,
  });

  const mainCoin = coins.data.sort((a, b) =>
    BigInt(b.balance) > BigInt(a.balance) ? 1 : -1
  )[0];

  if (!mainCoin) {
    console.error("No TALKEN coins found");
    process.exit(1);
  }

  console.log(`Admin: ${adminAddr}`);
  console.log(`Coin: ${mainCoin.coinObjectId}`);
  console.log(`Balance: ${Number(mainCoin.balance) / 10 ** DECIMALS} TALKEN\n`);

  // Check if balance is enough
  if (BigInt(mainCoin.balance) < TOTAL) {
    console.error(`Insufficient balance: need ${TOTAL}, have ${mainCoin.balance}`);
    process.exit(1);
  }

  // Distribute one by one
  console.log("Distributing...\n");
  let coinId = mainCoin.coinObjectId;

  for (const [key, info] of Object.entries(ALLOCATION)) {
    const addr = wallets[key]?.address;
    if (!addr) {
      console.error(`  Missing wallet for ${key}`);
      continue;
    }

    const amount = (TOTAL * BigInt(info.pct)) / BigInt(100);

    const tx = new Transaction();
    tx.moveCall({
      target: `${pkgId}::talken_token::split_and_transfer`,
      arguments: [
        tx.object(coinId),
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
    console.log(`  ✓ ${info.label.padEnd(8)} ${amountStr.padStart(14)} TALKEN → ${addr.slice(0, 10)}...`);
  }

  // Verify
  console.log("\nVerification:\n");
  for (const [key, info] of Object.entries(ALLOCATION)) {
    const addr = wallets[key]?.address;
    if (!addr) continue;

    const bal = await client.getCoins({
      owner: addr,
      coinType: `${pkgId}::talken_token::TALKEN_TOKEN`,
    });
    let total = 0n;
    for (const c of bal.data) total += BigInt(c.balance);
    console.log(`  ${info.label.padEnd(8)} ${(Number(total) / 10 ** DECIMALS).toLocaleString()} TALKEN`);
  }

  // Admin remaining
  const adminBal = await client.getCoins({
    owner: adminAddr,
    coinType: `${pkgId}::talken_token::TALKEN_TOKEN`,
  });
  let adminTotal = 0n;
  for (const c of adminBal.data) adminTotal += BigInt(c.balance);
  console.log(`  ${"Admin".padEnd(8)} ${(Number(adminTotal) / 10 ** DECIMALS).toLocaleString()} TALKEN`);

  console.log("\nDone!");
}

main().catch(console.error);
