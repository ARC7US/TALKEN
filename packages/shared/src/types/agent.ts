export interface Agent {
  id: string;
  name: string;
  skills: string[];
  stakeAmount: number;
  reputation: number;
  balance: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRegistration {
  id: string;
  name: string;
  skills: string[];
  signature: string;
}

export interface AgentPublicProfile {
  id: string;
  name: string;
  skills: string[];
  reputation: number;
  stakeAmount: number;
  completedTasks: number;
  publishedTasks: number;
  validationCount: number;
}
