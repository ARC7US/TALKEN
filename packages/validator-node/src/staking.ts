/**
 * TALKEN Staking Module
 * Handles approve + register on Arbitrum RelayRegistry contract.
 * Unstake is a two-step process: requestUnstake → wait 7 days → claimUnstake.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, type Hash } from "viem";
import { arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Contract addresses on Arbitrum One
const TALKEN_TOKEN: Address = "0x827559a7515631d621B8a5a4D30ab85667Daf228";
const RELAY_REGISTRY: Address = "0x085E3338c7C6BE74e5069838cde9AFE5B67e43c8";
const STAKE_AMOUNT = parseEther("100");

const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc";

// Minimal ABIs
const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "url", type: "string" }],
    outputs: [],
  },
  {
    name: "staked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "requestUnstake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "claimUnstake",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "stakes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "active", type: "bool" },
          { name: "stakedAt", type: "uint256" },
          { name: "unstakeAfter", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "isStaked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "operator", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isUnbonding",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "operator", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "MIN_STAKE_DURATION",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "UNBONDING_PERIOD",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "unregister",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

export interface StakeResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

function makeClient(privateKey: string) {
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  const publicClient = createPublicClient({ chain: arbitrum, transport: http(ARBITRUM_RPC) });
  const walletClient = createWalletClient({ account, chain: arbitrum, transport: http(ARBITRUM_RPC) });
  return { account, publicClient, walletClient };
}

export async function stakeAndRegister(
  privateKey: string,
  relayUrl: string,
): Promise<StakeResult> {
  const { account, publicClient, walletClient } = makeClient(privateKey);

  console.log(`钱包地址: ${account.address}`);
  console.log(`中继地址: ${relayUrl}`);

  // 1. Check ETH for gas
  const ethBalance = await publicClient.getBalance({ address: account.address });
  console.log(`ETH 余额 (Gas): ${formatEther(ethBalance)} ETH`);
  if (ethBalance === 0n) {
    return {
      success: false,
      error: "钱包没有 ETH，无法支付 Gas 费。请向 Arbitrum 钱包转入少量 ETH（约 $0.01 即可）。",
    };
  }

  // 2. Check TALKEN balance
  const balance = await publicClient.readContract({
    address: TALKEN_TOKEN,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`TALKEN 余额: ${formatEther(balance)}`);
  if (balance < STAKE_AMOUNT) {
    return {
      success: false,
      error: `余额不足。需要 100 TALKEN，当前 ${formatEther(balance)} TALKEN`,
    };
  }

  // 3. Check if already staked
  const alreadyStaked = await publicClient.readContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "staked",
    args: [account.address],
  });
  if (alreadyStaked) {
    return {
      success: false,
      error: "该地址已经质押并注册过了。如需更换 URL，请先执行 unstake。",
    };
  }

  // 4. Check allowance
  const allowance = await publicClient.readContract({
    address: TALKEN_TOKEN,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, RELAY_REGISTRY],
  });

  // 5. Approve if needed
  if (allowance < STAKE_AMOUNT) {
    console.log("正在授权 TALKEN 给 RelayRegistry...");
    const approveHash = await walletClient.writeContract({
      address: TALKEN_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [RELAY_REGISTRY, STAKE_AMOUNT],
    });
    console.log(`授权 TX: ${approveHash}`);
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log(`授权确认 (Block ${approveReceipt.blockNumber})`);
  } else {
    console.log("已有足够授权，跳过 approve");
  }

  // 6. Register
  console.log("正在注册中继节点...");
  const registerHash = await walletClient.writeContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [relayUrl],
  });
  console.log(`注册 TX: ${registerHash}`);
  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerHash });
  console.log(`注册确认 (Block ${registerReceipt.blockNumber})`);

  return { success: true, txHash: registerHash };
}

/**
 * Step 1: Request to unstake. Starts a 7-day unbonding period.
 * The node remains "active" during unbonding so it can finish pending tasks,
 * but the network should stop assigning new ones.
 */
export async function requestUnstake(privateKey: string): Promise<StakeResult> {
  const { account, publicClient, walletClient } = makeClient(privateKey);
  console.log(`钱包地址: ${account.address}`);

  const staked = await publicClient.readContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isStaked",
    args: [account.address],
  });
  if (!staked) {
    return { success: false, error: "该地址未质押。" };
  }

  const unbonding = await publicClient.readContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isUnbonding",
    args: [account.address],
  });
  if (unbonding) {
    return { success: false, error: "已经在解绑中，请等待 7 天后执行 claim-unstake 提取。" };
  }

  console.log("正在申请解除质押...");
  const hash = await walletClient.writeContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "requestUnstake",
  });
  console.log(`TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`申请成功。7 天后可执行 claim-unstake 提取 TALKEN。(Block ${receipt.blockNumber})`);

  return { success: true, txHash: hash };
}

/**
 * Step 2: Claim stake after the 7-day unbonding period expires.
 */
export async function claimUnstake(privateKey: string): Promise<StakeResult> {
  const { account, publicClient, walletClient } = makeClient(privateKey);
  console.log(`钱包地址: ${account.address}`);

  const staked = await publicClient.readContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "isStaked",
    args: [account.address],
  });
  if (!staked) {
    return { success: false, error: "该地址未质押。" };
  }

  const stakeInfo = await publicClient.readContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "stakes",
    args: [account.address],
  });

  if (stakeInfo.unstakeAfter === 0n) {
    return { success: false, error: "尚未申请解除质押，请先执行 request-unstake。" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < Number(stakeInfo.unstakeAfter)) {
    const remaining = Number(stakeInfo.unstakeAfter) - now;
    const days = Math.ceil(remaining / 86400);
    return {
      success: false,
      error: `解绑期未结束，还需等待约 ${days} 天。`,
    };
  }

  console.log("正在提取质押的 TALKEN...");
  const hash = await walletClient.writeContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "claimUnstake",
  });
  console.log(`TX: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`提取成功! 100 TALKEN 已退回。(Block ${receipt.blockNumber})`);

  return { success: true, txHash: hash };
}

/**
 * Legacy one-step unstake (for old contract). Will fail on new contract.
 */
export async function unstake(privateKey: string): Promise<StakeResult> {
  return requestUnstake(privateKey);
}

export async function checkStakeStatus(address: string): Promise<{
  staked: boolean;
  unbonding: boolean;
  balance: string;
  stakeAge?: string;
  unstakeAfter?: string;
}> {
  const publicClient = createPublicClient({ chain: arbitrum, transport: http(ARBITRUM_RPC) });
  const addr = address as Address;

  const [stakeInfo, balance] = await Promise.all([
    publicClient.readContract({
      address: RELAY_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "stakes",
      args: [addr],
    }),
    publicClient.readContract({
      address: TALKEN_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    }),
  ]);

  const result: {
    staked: boolean;
    unbonding: boolean;
    balance: string;
    stakeAge?: string;
    unstakeAfter?: string;
  } = {
    staked: stakeInfo.active,
    unbonding: stakeInfo.active && stakeInfo.unstakeAfter > 0n,
    balance: formatEther(balance),
  };

  if (stakeInfo.active && stakeInfo.stakedAt > 0n) {
    const age = Math.floor(Date.now() / 1000) - Number(stakeInfo.stakedAt);
    const days = Math.floor(age / 86400);
    result.stakeAge = `${days} 天`;
  }

  if (stakeInfo.active && stakeInfo.unstakeAfter > 0n) {
    const remaining = Number(stakeInfo.unstakeAfter) - Math.floor(Date.now() / 1000);
    if (remaining > 0) {
      const days = Math.ceil(remaining / 86400);
      result.unstakeAfter = `约 ${days} 天后可提取`;
    } else {
      result.unstakeAfter = "可以提取";
    }
  }

  return result;
}
