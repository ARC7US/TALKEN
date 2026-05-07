import { rawRun, rawGet } from "../db/connection.js";
import { encrypt, decrypt } from "@talken/shared";
import { RelayDataNotFoundError, RelayAccessDeniedError } from "@talken/shared";
import type { RelayData, RelayDataType } from "@talken/shared";
import { getSelectedValidators } from "./verification-service.js";
import { getTaskOrThrow } from "./task-service.js";
export { cleanupRelayData, cleanupOrphanedData } from "./relay-cleanup.js";

interface RelayRow {
  id: number;
  task_id: string;
  data_type: string;
  encrypted_content: string;
  stored_by: string;
  created_at: string;
}

function mapRelay(row: RelayRow): RelayData {
  return {
    id: row.id,
    taskId: row.task_id,
    dataType: row.data_type as RelayDataType,
    encryptedContent: row.encrypted_content,
    storedBy: row.stored_by,
    createdAt: row.created_at,
  };
}

/**
 * Store encrypted relay data.
 * The content is encrypted with AES-256-GCM before storage.
 */
export function storeData(
  taskId: string,
  dataType: RelayDataType,
  content: string,
  storedBy: string,
): RelayData {
  const encrypted = encrypt(taskId, content);
  const now = new Date().toISOString();

  rawRun(
    "INSERT INTO relay_data (task_id, data_type, encrypted_content, stored_by, created_at) VALUES (?, ?, ?, ?, ?)",
    [taskId, dataType, encrypted, storedBy, now],
  );

  const row = rawGet<RelayRow>(
    "SELECT * FROM relay_data WHERE task_id = ? AND data_type = ? ORDER BY id DESC LIMIT 1",
    [taskId, dataType],
  )!;

  return mapRelay(row);
}

/**
 * Get and decrypt relay data with access control.
 *
 * Access matrix:
 *   brief:  publisher (rw), executor (r), selected validators (r)
 *   result: publisher (r), executor (rw), selected validators (r)
 */
export function getData(
  taskId: string,
  dataType: RelayDataType,
  requesterId: string,
): RelayData {
  const row = rawGet<RelayRow>(
    "SELECT * FROM relay_data WHERE task_id = ? AND data_type = ?",
    [taskId, dataType],
  );

  if (!row) {
    throw new RelayDataNotFoundError(taskId, dataType);
  }

  // Access control
  const task = getTaskOrThrow(taskId);
  const selectedValidators = getSelectedValidators(taskId);
  const isValidator = selectedValidators.includes(requesterId);

  if (dataType === "brief") {
    const allowed =
      requesterId === task.publisherId ||
      requesterId === task.executorId ||
      isValidator;
    if (!allowed) throw new RelayAccessDeniedError(taskId, dataType, requesterId);
  } else {
    // result
    const allowed =
      requesterId === task.publisherId ||
      requesterId === task.executorId ||
      isValidator;
    if (!allowed) throw new RelayAccessDeniedError(taskId, dataType, requesterId);
  }

  const relay = mapRelay(row);
  // Decrypt the content for the caller
  relay.encryptedContent = decrypt(taskId, relay.encryptedContent);
  return relay;
}

/**
 * Delete relay data for a specific task and type.
 */
export function deleteData(taskId: string, dataType: RelayDataType): void {
  rawRun("DELETE FROM relay_data WHERE task_id = ? AND data_type = ?", [taskId, dataType]);
}
