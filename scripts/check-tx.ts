import { IotaClient } from "@iota/iota-sdk/client";

const PKG = "0x118d27c5bb0a5c09c14e4bd34f47b1e3861bd380a750e991c588f31c19c02191";
const ADMIN_ADDR = "0x0a803b25fdcd5f02d018112ed430d524eda932b7016220dcf0f027ff061b712c";

async function main() {
  const client = new IotaClient({ url: "https://api.testnet.iota.cafe" });

  const action = process.argv[2] || "tx";
  const digest = process.argv[3] || "Dx6H1ZiGYSdQFW5ajqEKuVLnSAThzaA5R23f92mZ8GVz";

  if (action === "tx") {
    console.log(`Querying transaction: ${digest}`);
    try {
      const tx = await client.getTransactionBlock({
        digest,
        options: { showEffects: true, showInput: true, showEvents: true },
      });
      console.log("Status:", JSON.stringify(tx.effects?.status, null, 2));
      console.log("Gas used:", JSON.stringify(tx.effects?.gasUsed, null, 2));
      console.log("Events:", JSON.stringify(tx.events, null, 2));
    } catch (e: any) {
      console.log("Error:", e.message);
    }
  } else if (action === "balance") {
    const addr = process.argv[3] || ADMIN_ADDR;
    console.log(`Querying TALKEN balance for: ${addr}`);
    try {
      const coinType = `${PKG}::talken_token::TALKEN_TOKEN`;
      const balance = await client.getBalance({ owner: addr, coinType });
      console.log("Raw balance:", JSON.stringify(balance, null, 2));
      console.log("TALKEN balance:", Number(balance.totalBalance) / 1e9);
    } catch (e: any) {
      console.log("Error:", e.message);
    }
  }
}

main();
