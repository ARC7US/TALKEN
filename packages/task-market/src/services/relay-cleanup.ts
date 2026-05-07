import { rawRun, rawAll } from "../db/connection.js";

/**
 * Clean up all relay data for a task.
 * Extracted to avoid circular dependencies between relay-service and task-service.
 */
export function cleanupRelayData(taskId: string): void {
  rawRun("DELETE FROM relay_data WHERE task_id = ?", [taskId]);
}

/**
 * Clean up relay data for tasks that no longer exist.
 * Returns the number of orphaned records deleted.
 */
export function cleanupOrphanedData(): number {
  const orphaned = rawAll<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM relay_data
     WHERE task_id NOT IN (SELECT id FROM tasks)`,
  );
  const count = orphaned[0]?.cnt ?? 0;

  if (count > 0) {
    rawRun(
      `DELETE FROM relay_data WHERE task_id NOT IN (SELECT id FROM tasks)`,
    );
  }

  return count;
}
