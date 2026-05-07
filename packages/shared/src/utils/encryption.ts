import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte AES key from a taskId.
 * Deterministic: same taskId always produces the same key.
 */
function deriveRelayKey(taskId: string): Buffer {
  return createHash("sha256").update(taskId + "-relay-key").digest();
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a base64url-encoded string: IV (12B) || authTag (16B) || ciphertext.
 */
export function encrypt(taskId: string, plaintext: string): string {
  const key = deriveRelayKey(taskId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Pack: IV || authTag || ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString("base64url");
}

/**
 * Decrypt a base64url-encoded string produced by `encrypt`.
 */
export function decrypt(taskId: string, encryptedBase64url: string): string {
  const key = deriveRelayKey(taskId);
  const packed = Buffer.from(encryptedBase64url, "base64url");

  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
