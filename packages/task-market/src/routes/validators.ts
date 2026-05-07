import type { FastifyInstance } from "fastify";
import { StakeSchema, InsufficientBalanceError, generateId } from "@talken/shared";
import { authRequired } from "../middleware/auth.js";
import {
  getAgentOrThrow,
  updateAgentBalance,
  updateAgentStake,
  listValidators,
} from "../services/agent-service.js";
import { rawRun, rawGet } from "../db/connection.js";

export async function validatorRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/validators/stake — stake tokens
  app.post("/api/v1/validators/stake", { preHandler: [authRequired] }, async (request, reply) => {
    const body = StakeSchema.parse(request.body);
    const agentId = (request.headers["x-talken-agent-id"] as string) || "validator_1";

    const agent = getAgentOrThrow(agentId);

    if (agent.balance < body.amount) {
      throw new InsufficientBalanceError(body.amount, agent.balance);
    }

    // Deduct balance, add stake
    updateAgentBalance(agentId, agent.balance - body.amount);
    updateAgentStake(agentId, agent.stakeAmount + body.amount);

    // Insert stake record
    const stakeId = generateId("stake_");
    const now = new Date().toISOString();
    rawRun(
      "INSERT INTO stakes (id, agent_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
      [stakeId, agentId, body.amount, "active", now]
    );

    const updatedAgent = getAgentOrThrow(agentId);
    return reply.send({ success: true, data: updatedAgent });
  });

  // POST /api/v1/validators/unstake — unstake tokens
  app.post("/api/v1/validators/unstake", { preHandler: [authRequired] }, async (request, reply) => {
    const body = StakeSchema.parse(request.body);
    const agentId = (request.headers["x-talken-agent-id"] as string) || "validator_1";

    const agent = getAgentOrThrow(agentId);

    if (agent.stakeAmount < body.amount) {
      throw new Error(`Insufficient stake: need ${body.amount}, have ${agent.stakeAmount}`);
    }

    // Add balance, reduce stake
    updateAgentBalance(agentId, agent.balance + body.amount);
    updateAgentStake(agentId, agent.stakeAmount - body.amount);

    // Update stake record
    const now = new Date().toISOString();
    rawRun(
      "UPDATE stakes SET status = 'withdrawn', unbonded_at = ? WHERE id = (SELECT id FROM stakes WHERE agent_id = ? AND status = 'active' LIMIT 1)",
      [now, agentId]
    );

    const updatedAgent = getAgentOrThrow(agentId);
    return reply.send({ success: true, data: updatedAgent });
  });

  // GET /api/v1/validators — list validators
  app.get("/api/v1/validators", async (request, reply) => {
    const validators = listValidators();
    return reply.send({ success: true, data: validators });
  });
}
