export interface StellarService {
  transfer(from: string, to: string, amount: number): Promise<string>;
  protocolMint(to: string, amount: number): Promise<string>;
  protocolSlash(validatorId: string, amount: number): Promise<string>;
  getBalance(agentId: string): Promise<number>;
  registerAddress(agentId: string, address: string, privateKey: string): void;
  getAddress(agentId: string): string | null;
}

export { MockStellarService } from "./mock.js";
export { TangleService } from "./tangle.js";

import { MockStellarService } from "./mock.js";
import { TangleService } from "./tangle.js";
import { config } from "../config.js";

/**
 * Create a StellarService instance based on STELLAR_MODE config.
 *
 * - "mock": local DB-only mode (for development/testing)
 * - "testnet": real IOTA testnet transactions
 * - "mainnet": real IOTA mainnet transactions
 */
export function createStellarService(): StellarService {
  const mode = config.STELLAR_MODE;

  if (mode === "mock") {
    return new MockStellarService();
  }

  // testnet or mainnet — use real TangleService
  const networkUrl =
    mode === "mainnet"
      ? "https://api.mainnet.iota.cafe"
      : "https://api.testnet.iota.cafe";

  const adminKey = config.IOTA_ADMIN_PRIVATE_KEY ?? "";
  const contractId = config.TALKEN_CONTRACT_PACKAGE_ID;
  const treasuryCapId = config.TREASURY_CAP_ID;
  const adminCapId = config.ADMIN_CAP_ID;

  if (!adminKey) {
    console.warn(
      `[stellar] STELLAR_MODE=${mode} but IOTA_ADMIN_PRIVATE_KEY not set. ` +
      `Falling back to mock mode.`
    );
    return new MockStellarService();
  }

  return new TangleService({
    networkUrl,
    adminPrivateKey: adminKey,
    contractPackageId: contractId,
    treasuryCapId,
    adminCapId,
  });
}
