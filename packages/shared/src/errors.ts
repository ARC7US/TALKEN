import { ErrorCodes, type ErrorCode } from "./constants.js";

export class TalkenError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;

  constructor(message: string, code: ErrorCode, statusCode: number = 500) {
    super(message);
    this.name = "TalkenError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class TaskNotFoundError extends TalkenError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, ErrorCodes.TASK_NOT_FOUND, 404);
  }
}

export class InvalidTransitionError extends TalkenError {
  constructor(currentStatus: string, event: string) {
    super(`Cannot perform '${event}' when task is '${currentStatus}'`, ErrorCodes.INVALID_TRANSITION, 409);
  }
}

export class AgentNotFoundError extends TalkenError {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`, ErrorCodes.AGENT_NOT_FOUND, 404);
  }
}

export class ValidatorNotSelectedError extends TalkenError {
  constructor(validatorId: string, taskId: string) {
    super(`Validator ${validatorId} not selected for task ${taskId}`, ErrorCodes.VALIDATOR_NOT_SELECTED, 403);
  }
}

export class UnauthorizedError extends TalkenError {
  constructor(message: string = "Unauthorized") {
    super(message, ErrorCodes.UNAUTHORIZED, 401);
  }
}

export class InsufficientBalanceError extends TalkenError {
  constructor(required: number, available: number) {
    super(`Insufficient balance: need ${required}, have ${available}`, ErrorCodes.INSUFFICIENT_BALANCE, 402);
  }
}

export class InsufficientStakeError extends TalkenError {
  constructor(required: number, available: number) {
    super(`Insufficient stake: need ${required}, have ${available}`, ErrorCodes.INSUFFICIENT_STAKE, 402);
  }
}

export class TaskExpiredError extends TalkenError {
  constructor(taskId: string) {
    super(`Task expired: ${taskId}`, ErrorCodes.TASK_EXPIRED, 410);
  }
}

export class AlreadyAcceptedError extends TalkenError {
  constructor(taskId: string) {
    super(`Task already accepted: ${taskId}`, ErrorCodes.ALREADY_ACCEPTED, 409);
  }
}

export class RelayDataNotFoundError extends TalkenError {
  constructor(taskId: string, dataType: string) {
    super(`Relay ${dataType} not found for task ${taskId}`, ErrorCodes.RELAY_DATA_NOT_FOUND, 404);
  }
}

export class RelayAccessDeniedError extends TalkenError {
  constructor(taskId: string, dataType: string, agentId: string) {
    super(`Agent ${agentId} cannot access ${dataType} for task ${taskId}`, ErrorCodes.RELAY_ACCESS_DENIED, 403);
  }
}

export class NotAggregatorError extends TalkenError {
  constructor(validatorId: string, taskId: string) {
    super(`Validator ${validatorId} is not the aggregator for task ${taskId}`, ErrorCodes.NOT_AGGREGATOR, 403);
  }
}

export class AlreadyCommittedError extends TalkenError {
  constructor(validatorId: string, taskId: string) {
    super(`Validator ${validatorId} already committed for task ${taskId}`, ErrorCodes.ALREADY_COMMITTED, 409);
  }
}

export class CommitPhaseNotDoneError extends TalkenError {
  constructor(taskId: string) {
    super(`Commit phase not complete for task ${taskId}`, ErrorCodes.COMMIT_PHASE_NOT_DONE, 400);
  }
}

export class AlreadyRevealedError extends TalkenError {
  constructor(validatorId: string, taskId: string) {
    super(`Validator ${validatorId} already revealed for task ${taskId}`, ErrorCodes.ALREADY_REVEALED, 409);
  }
}

export class InvalidRevealError extends TalkenError {
  constructor(validatorId: string, taskId: string) {
    super(`Invalid reveal from validator ${validatorId} for task ${taskId}`, ErrorCodes.INVALID_REVEAL, 400);
  }
}

export class NoCommitFoundError extends TalkenError {
  constructor(validatorId: string, taskId: string) {
    super(`No commit found for validator ${validatorId} on task ${taskId}`, ErrorCodes.NO_COMMIT_FOUND, 404);
  }
}
