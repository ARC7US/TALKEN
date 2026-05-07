/**
 * Mint TALKEN tokens to admin address.
 * Usage: npx tsx scripts/mint-tokens.ts [amount_in_tokens]
 * Default: 100,000,000 (100M)
 */

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

async function main() {
  const tokenAmount = parseInt(process.argv[2] ?? "100000000");
  const baseAmount = BigInt(tokenAmount) * BigInt(10 ** DECIMALS);

  const mode = process.env.STELLAR_MODE ?? "testnet";
  const rpcUrl = mode === "mock"
    ? "https://api.testnet.iota.cafe"
    : `https://api.${mode}.iota.cafe`;
  const pkgId = process.env.TALKEN_CONTRACT_PACKAGE_ID!;
  const treasuryCapId = process.env.TREASURY_CAP_ID!;
  const adminCapId = process.env.ADMIN_CAP_ID!;
  const adminKey = process.env.IOTA_ADMIN_PRIVATE_KEY!;

  // Dynamic imports
  const { Ed25519Keypair } = await import("@iota/iota-sdk/keypairs/ed25519");
  const { IotaClient } = await import("@iota/iota-sdk/client");
  const { Transaction } = await import("@iota/iota-sdk/transactions");

  const client = new IotaClient({ url: rpcUrl });
  const keypair = Ed25519Keypair.fromSecretKey(adminKey);
  const adminAddr = keypair.getPublicKey().toIotaAddress();

  console.log(`Network: ${mode}`);
  console.log(`Minting ${tokenAmount.toLocaleString()} TALKEN to ${adminAddr}...`);

  const tx = new Transaction();
  tx.moveCall({
    target: `${pkgId}::talken_token::mint`,
    arguments: [
      tx.object(adminCapId),
      tx.object(treasuryCapId),
      tx.pure.address(adminAddr),
      tx.pure.u64(baseAmount.toString()),
    ],
  });

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });
  await client.waitForTransaction({ digest: result.digest });

  console.log(`\nMinted ${tokenAmount.toLocaleString()} TALKEN`);
  console.log(`TX: ${result.digest}`);

  // Verify
  const coins = await client.getCoins({
    owner: adminAddr,
    coinType: `${pkgId}::talken_token::TALKEN_TOKEN`,
  });
  let total = 0n;
  for (const c of coins.data) total += BigInt(c.balance);
  console.log(`Balance: ${(Number(total) / 10 ** DECIMALS).toLocaleString()} TALKEN`);
}

main().catch(console.error);
