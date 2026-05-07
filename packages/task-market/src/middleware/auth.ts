import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { UnauthorizedError } from "@talken/shared";
import { verifySignature } from "@talken/shared";
import { getAgentPublicKey } from "../services/agent-service.js";

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes

// Nonce dedup: store (agentId + timestamp) pairs seen recently
// In production this would be Redis; in-memory is fine for single-server MVP
const seenNonces = new Map<string, number>(); // key → expiry timestamp

// Clean up expired nonces every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, expiry] of seenNonces) {
    if (expiry < now) seenNonces.delete(key);
  }
}, 60_000);

export async function authRequired(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Skip auth if MOCK_AUTH is enabled
  if (config.MOCK_AUTH) return;

  const agentId = request.headers["x-talken-agent-id"] as string | undefined;
  const timestamp = request.headers["x-talken-timestamp"] as string | undefined;
  const signature = request.headers["x-talken-signature"] as string | undefined;

  if (!agentId || !timestamp || !signature) {
    throw new UnauthorizedError(
      "Missing required auth headers: X-Talken-Agent-Id, X-Talken-Timestamp, X-Talken-Signature",
    );
  }

  // 1. Check timestamp is within ±5 minutes
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    throw new UnauthorizedError("Invalid X-Talken-Timestamp: not a number");
  }
  const now = Date.now();
  if (Math.abs(now - ts) > TIMESTAMP_WINDOW_MS) {
    throw new UnauthorizedError("Request timestamp is outside the ±5 minute window");
  }

  // 2. Nonce dedup: same agent + timestamp = replay attack
  const nonceKey = `${agentId}:${timestamp}`;
  if (seenNonces.has(nonceKey)) {
    throw new UnauthorizedError("Duplicate request (replay detected)");
  }
  seenNonces.set(nonceKey, now + TIMESTAMP_WINDOW_MS);

  // 3. Look up agent's public key
  const publicKey = getAgentPublicKey(agentId);
  if (!publicKey) {
    throw new UnauthorizedError(`Agent ${agentId} has no registered public key`);
  }

  // 4. Build the canonical string and verify signature
  const method = request.method;
  const path = request.url;
  const bodyStr = request.body ? JSON.stringify(request.body) : undefined;

  const valid = await verifySignature(publicKey, method, path, timestamp, signature, bodyStr);
  if (!valid) {
    throw new UnauthorizedError("Invalid signature");
  }
}
