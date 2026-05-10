/**
 * TALKEN Staking Module
 * Handles approve + register on Arbitrum RelayRegistry contract.
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, type Hash } from "viem";
import { arbitrum } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Contract addresses on Arbitrum One
const TALKEN_TOKEN: Address = "0x827559a7515631d621B8a5a4D30ab85667Daf228";
const RELAY_REGISTRY: Address = "0x085E3338c7C6BE74e5069838cde9AFE5B67e43c8";
const STAKE_AMOUNT = parseEther("100");

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
    name: "unregister",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "staked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ARBITRUM_RPC = "https://arb1.arbitrum.io/rpc";

export interface StakeResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export async function stakeAndRegister(
  privateKey: string,
  relayUrl: string,
): Promise<StakeResult> {
  // Normalize private key
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);

  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
  });

  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
  });

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

  // 2. Check if already staked
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

  // 3. Check allowance
  const allowance = await publicClient.readContract({
    address: TALKEN_TOKEN,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, RELAY_REGISTRY],
  });

  // 4. Approve if needed
  if (allowance < STAKE_AMOUNT) {
    console.log("正在授权 TALKEN 给 RelayRegistry...");
    const approveHash = await walletClient.writeContract({
      address: TALKEN_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [RELAY_REGISTRY, STAKE_AMOUNT],
    });
    console.log(`授权 TX: ${approveHash}`);

    // Wait for confirmation
    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });
    console.log(`授权确认 (Block ${approveReceipt.blockNumber})`);
  } else {
    console.log("已有足够授权，跳过 approve");
  }

  // 5. Register
  console.log("正在注册中继节点...");
  const registerHash = await walletClient.writeContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [relayUrl],
  });
  console.log(`注册 TX: ${registerHash}`);

  const registerReceipt = await publicClient.waitForTransactionReceipt({
    hash: registerHash,
  });
  console.log(`注册确认 (Block ${registerReceipt.blockNumber})`);

  return {
    success: true,
    txHash: registerHash,
  };
}

export async function unstake(privateKey: string): Promise<StakeResult> {
  const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key as `0x${string}`);

  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
  });

  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
  });

  console.log(`钱包地址: ${account.address}`);

  // Check if staked
  const isStaked = await publicClient.readContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "staked",
    args: [account.address],
  });

  if (!isStaked) {
    return { success: false, error: "该地址未质押，无法解除。" };
  }

  console.log("正在解除质押...");
  const hash = await walletClient.writeContract({
    address: RELAY_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "unregister",
  });
  console.log(`TX: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`解除质押确认 (Block ${receipt.blockNumber})`);

  return { success: true, txHash: hash };
}

export async function checkStakeStatus(address: string): Promise<{
  staked: boolean;
  balance: string;
  relayUrl?: string;
}> {
  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(ARBITRUM_RPC),
  });

  const addr = address as Address;

  const [staked, balance] = await Promise.all([
    publicClient.readContract({
      address: RELAY_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "staked",
      args: [addr],
    }),
    publicClient.readContract({
      address: TALKEN_TOKEN,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr],
    }),
  ]);

  return {
    staked,
    balance: formatEther(balance),
  };
}
