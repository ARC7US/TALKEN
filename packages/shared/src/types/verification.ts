export interface VerificationVote {
  id: string;
  taskId: string;
  validatorId: string;
  passed: boolean;
  createdAt: string;
}

export interface ConsensusOutcome {
  passed: boolean;
  qualityScore: number;
  voteSummary: { passed: number; failed: number };
}

export interface BlindVote {
  blindId: string;
  passed: boolean;
}

export interface AggregationSession {
  taskId: string;
  aggregatorId: string;
  blindVotes: BlindVote[];
  outcome: ConsensusOutcome | null;
  createdAt: string;
}

export interface CommitVote {
  id: string;
  taskId: string;
  validatorId: string;
  voteHash: string;
  createdAt: string;
}

export interface RevealVote {
  id: string;
  taskId: string;
  validatorId: string;
  passed: boolean;
  secret: string;
  createdAt: string;
}
