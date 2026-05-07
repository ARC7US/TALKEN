import { generateKeyPair, signPayload } from "@talken/shared";

export class Keyring {
  private keys: Map<string, { publicKey: string; secretKey: string }> = new Map();

  /** Generate a new ed25519 key pair for an agent */
  generate(agentId: string): { publicKey: string; secretKey: string } {
    const pair = generateKeyPair();
    this.keys.set(agentId, pair);
    return pair;
  }

  /** Import an existing key pair (e.g. from storage) */
  import(agentId: string, publicKey: string, secretKey: string): void {
    this.keys.set(agentId, { publicKey, secretKey });
  }

  getPublicKey(agentId: string): string | null {
    return this.keys.get(agentId)?.publicKey ?? null;
  }

  getSecretKey(agentId: string): string | null {
    return this.keys.get(agentId)?.secretKey ?? null;
  }

  hasKey(agentId: string): boolean {
    return this.keys.has(agentId);
  }

  /**
   * Sign a request.
   * Builds canonical string: METHOD\nPATH\nTIMESTAMP\nBODY_HASH
   * Returns base64url-encoded ed25519 signature.
   */
  async sign(
    agentId: string,
    method: string,
    path: string,
    timestamp: string,
    body?: string,
  ): Promise<string> {
    const key = this.keys.get(agentId);
    if (!key) throw new Error(`No key for agent ${agentId}`);
    return signPayload(key.secretKey, method, path, timestamp, body);
  }
}
