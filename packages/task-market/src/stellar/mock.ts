import type { StellarService } from "./index.js";
import { rawRun, rawGet } from "../db/connection.js";
import { InsufficientBalanceError } from "@talken/shared";

export class MockStellarService implements StellarService {
  async transfer(from: string, to: string, amount: number): Promise<string> {
    const sender = rawGet<{ balance: number }>("SELECT balance FROM agents WHERE id = ?", [from]);
    if (!sender) throw new Error(`Agent not found: ${from}`);
    if (sender.balance < amount) {
      throw new InsufficientBalanceError(amount, sender.balance);
    }

    const now = new Date().toISOString();
    rawRun("UPDATE agents SET balance = balance - ?, updated_at = ? WHERE id = ?", [amount, now, from]);
    rawRun("UPDATE agents SET balance = balance + ?, updated_at = ? WHERE id = ?", [amount, now, to]);

    return `mock_tx_${Date.now()}`;
  }

  async protocolMint(to: string, amount: number): Promise<string> {
    const now = new Date().toISOString();
    rawRun("UPDATE agents SET balance = balance + ?, updated_at = ? WHERE id = ?", [amount, now, to]);
    return `mock_mint_${Date.now()}`;
  }

  async protocolSlash(validatorId: string, amount: number): Promise<string> {
    const now = new Date().toISOString();
    rawRun("UPDATE agents SET stake_amount = stake_amount - ?, updated_at = ? WHERE id = ?", [amount, now, validatorId]);
    return `mock_slash_${Date.now()}`;
  }

  async getBalance(agentId: string): Promise<number> {
    const agent = rawGet<{ balance: number }>("SELECT balance FROM agents WHERE id = ?", [agentId]);
    return agent?.balance ?? 0;
  }

  registerAddress(_agentId: string, _address: string, _privateKey: string): void {
    // No-op in mock mode — all operations are local DB only
  }

  getAddress(_agentId: string): string | null {
    return null; // No blockchain addresses in mock mode
  }
}
