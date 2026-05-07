/**
 * Check TALKEN token balances across all allocation wallets.
 *
 * Usage:
 *   npx tsx scripts/check-tokens.ts
 */

import { IotaClient, getFullnodeUrl } from "@iota/iota-sdk/client";

const ALLOCATION_LABELS: Record<string, string> = {
  team: "团队",
  ecosystem: "生态基金",
  privateSale: "私募",
  publicSale: "公募",
  foundation: "基金会金库",
  liquidity: "流动性",
  airdrop: "空投",
  advisors: "顾问",
};

async function main() {
  const mode = process.env.DISTRIBUTION_MODE ?? "testnet";
  const rpcUrl = getFullnodeUrl(mode as any);
  const pkgId = process.env.TALKEN_CONTRACT_PACKAGE_ID;

  if (!pkgId) {
    console.error("Set TALKEN_CONTRACT_PACKAGE_ID in .env");
    process.exit(1);
  }

  const client = new IotaClient({ url: rpcUrl });
  const coinType = `${pkgId}::talken_token::TALKEN_TOKEN`;

  // Query all objects of TALKEN type
  console.log(`Network: ${mode}`);
  console.log(`Coin type: ${coinType}\n`);

  const owners = process.env.TALKEN_WALLETS?.split(",") ?? [];
  if (owners.length === 0) {
    console.log("Set TALKEN_WALLETS (comma-separated addresses) in .env to check specific wallets.");
    console.log("Or use: npx tsx scripts/check-tokens.ts --all");
    return;
  }

  let total = 0n;

  console.log("┌──────────────────────┬──────────────────────────┬──────────────────┐");
  console.log("│ Label                │ Address                  │ Balance          │");
  console.log("├──────────────────────┼──────────────────────────┼──────────────────┤");

  for (const entry of owners) {
    const [label, addr] = entry.includes("=") ? entry.split("=") : ["", entry.trim()];
    const address = (addr || label).trim();
    if (!address) continue;

    try {
      const coins = await client.getCoins({ owner: address, coinType });
      let balance = 0n;
      for (const c of coins.data) balance += BigInt(c.balance);
      total += balance;

      const labelStr = (label || address.slice(0, 10) + "...").padEnd(20);
      const addrStr = address.slice(0, 22).padEnd(24);
      const balStr = (Number(balance) / 1e9).toLocaleString().padStart(16);
      console.log(`│ ${labelStr} │ ${addrStr} │ ${balStr} │`);
    } catch {
      const labelStr = (label || address.slice(0, 10) + "...").padEnd(20);
      const addrStr = address.slice(0, 22).padEnd(24);
      console.log(`│ ${labelStr} │ ${addrStr} │        (error) │`);
    }
  }

  console.log("├──────────────────────┼──────────────────────────┼──────────────────┤");
  const totalStr = (Number(total) / 1e9).toLocaleString().padStart(16);
  console.log(`│ ${"TOTAL".padEnd(20)} │ ${"".padEnd(24)} │ ${totalStr} │`);
  console.log("└──────────────────────┴──────────────────────────┴──────────────────┘");
}

main().catch(console.error);
