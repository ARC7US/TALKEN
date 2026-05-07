export interface Settlement {
  id: string;
  taskId: string;
  publisherId: string;
  executorId: string;
  feeTransfer: number;
  mintReward: number;
  validatorRewards: Record<string, number>;
  txHash: string;
  settledAt: string;
}

export interface RewardBreakdown {
  executorFee: number;
  executorMint: number;
  executorTotal: number;
  validatorRewards: Array<{ validatorId: string; amount: number }>;
}

export interface StakeRecord {
  id: string;
  agentId: string;
  amount: number;
  status: string;
  createdAt: string;
  unbondedAt: string | null;
}
