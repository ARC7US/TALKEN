/**
 * Standalone staking script — runs with plain `node`, no tsx needed.
 * Usage: TALKEN_WALLET_PRIVATE_KEY=0x... node scripts/stake.mjs <relay_url>
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const TALKEN_TOKEN = "0x827559a7515631d621B8a5a4D30ab85667Daf228";
const RELAY_REGISTRY = "0x085E3338c7C6BE74e5069838cde9AFE5B67e43c8";
const STAKE_AMOUNT = parseEther("100");
const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc";

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
];

const REGISTRY_ABI = [
  { name: "register", type: "function", stateMutability: "nonpayable", inputs: [{ name: "url", type: "string" }], outputs: [] },
  { name: "staked", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
];

const pk = process.env.TALKEN_WALLET_PRIVATE_KEY;
const relayUrl = process.argv[2];

if (!pk) {
  console.error("TALKEN_WALLET_PRIVATE_KEY not set");
  process.exit(1);
}
if (!relayUrl) {
  console.error("Usage: node stake.mjs <relay_url>");
  process.exit(1);
}

const key = pk.startsWith("0x") ? pk : `0x${pk}`;
const account = privateKeyToAccount(key);

const publicClient = createPublicClient({ chain: arbitrum, transport: http(ARBITRUM_RPC) });
const walletClient = createWalletClient({ account, chain: arbitrum, transport: http(ARBITRUM_RPC) });

console.log(`钱包地址: ${account.address}`);
console.log(`中继地址: ${relayUrl}`);

// 1. Check ETH balance for gas
const ethBalance = await publicClient.getBalance({ address: account.address });
console.log(`ETH 余额 (Gas): ${formatEther(ethBalance)} ETH`);
if (ethBalance === 0n) {
  console.error("钱包没有 ETH，无法支付 Gas 费。请向 Arbitrum 钱包转入少量 ETH（约 $0.01 即可）。");
  process.exit(1);
}

// 2. Check TALKEN balance
const balance = await publicClient.readContract({ address: TALKEN_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
console.log(`TALKEN 余额: ${formatEther(balance)}`);
if (balance < STAKE_AMOUNT) {
  console.error(`余额不足。需要 100 TALKEN，当前 ${formatEther(balance)} TALKEN`);
  process.exit(1);
}

// 2. Check if already staked
const alreadyStaked = await publicClient.readContract({ address: RELAY_REGISTRY, abi: REGISTRY_ABI, functionName: "staked", args: [account.address] });
if (alreadyStaked) {
  console.log("该地址已经质押并注册过了。");
  process.exit(0);
}

// 3. Approve if needed
const allowance = await publicClient.readContract({ address: TALKEN_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [account.address, RELAY_REGISTRY] });
if (allowance < STAKE_AMOUNT) {
  console.log("正在授权 TALKEN...");
  const hash = await walletClient.writeContract({ address: TALKEN_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [RELAY_REGISTRY, STAKE_AMOUNT] });
  console.log(`授权 TX: ${hash}`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("授权确认");
}

// 4. Register
console.log("正在注册中继节点...");
const regHash = await walletClient.writeContract({ address: RELAY_REGISTRY, abi: REGISTRY_ABI, functionName: "register", args: [relayUrl] });
console.log(`注册 TX: ${regHash}`);
await publicClient.waitForTransactionReceipt({ hash: regHash });
console.log(`质押成功! TX: ${regHash}`);
