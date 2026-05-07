export const TaskEvent = {
  ACCEPT: "ACCEPT",
  SUBMIT: "SUBMIT",
  AGGREGATE: "AGGREGATE",
  VALIDATE_PASS: "VALIDATE_PASS",
  VALIDATE_FAIL: "VALIDATE_FAIL",
  CONFIRM: "CONFIRM",
  REJECT: "REJECT",
  SETTLE: "SETTLE",
  EXPIRE: "EXPIRE",
  REVERIFY_PASS: "REVERIFY_PASS",
  REVERIFY_FAIL: "REVERIFY_FAIL",
} as const;

export type TaskEvent = (typeof TaskEvent)[keyof typeof TaskEvent];

const validTransitions: Record<string, TaskEvent[]> = {
  published: [TaskEvent.ACCEPT, TaskEvent.EXPIRE],
  accepted: [TaskEvent.SUBMIT, TaskEvent.EXPIRE],
  submitted: [TaskEvent.AGGREGATE, TaskEvent.EXPIRE],
  aggregating: [TaskEvent.VALIDATE_PASS, TaskEvent.VALIDATE_FAIL],
  verified: [TaskEvent.CONFIRM, TaskEvent.REJECT],
  re_verifying: [TaskEvent.REVERIFY_PASS, TaskEvent.REVERIFY_FAIL],
  confirmed: [TaskEvent.SETTLE],
  settled: [],
  rejected: [],
  expired: [],
  cancelled: [],
};

export function canTransition(status: string, event: string): boolean {
  const allowed = validTransitions[status];
  if (!allowed) return false;
  return (allowed as string[]).includes(event);
}

export function getValidNextEvents(status: string): TaskEvent[] {
  return validTransitions[status] ?? [];
}

export function getNextStatus(status: string, event: string): string | null {
  if (!canTransition(status, event)) return null;

  const transitionMap: Record<string, Record<string, string>> = {
    published: { ACCEPT: "accepted", EXPIRE: "expired" },
    accepted: { SUBMIT: "submitted", EXPIRE: "expired" },
    submitted: { AGGREGATE: "aggregating", EXPIRE: "expired" },
    aggregating: { VALIDATE_PASS: "verified", VALIDATE_FAIL: "rejected" },
    verified: { CONFIRM: "confirmed", REJECT: "re_verifying" },
    re_verifying: { REVERIFY_PASS: "verified", REVERIFY_FAIL: "rejected" },
    confirmed: { SETTLE: "settled" },
  };

  return transitionMap[status]?.[event] ?? null;
}
