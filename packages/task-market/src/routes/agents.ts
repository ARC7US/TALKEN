import type { FastifyInstance } from "fastify";
import { AgentRegisterSchema } from "@talken/shared";
import { authRequired } from "../middleware/auth.js";
import {
  registerAgent,
  getAgentOrThrow,
  getAgentPublicProfile,
  listAgents,
  updateAgentBalance,
  updateAgentStake,
} from "../services/agent-service.js";
import { createStellarService } from "../stellar/index.js";

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/agents — register agent
  app.post("/api/v1/agents", async (request, reply) => {
    const body = AgentRegisterSchema.parse(request.body);

    const agent = registerAgent(body.id, body.name, body.skills, body.publicKey);

    return reply.status(201).send({ success: true, data: agent });
  });

  // GET /api/v1/agents — list all agents
  app.get("/api/v1/agents", async (request, reply) => {
    const agents = listAgents();
    return reply.send({ success: true, data: agents });
  });

  // GET /api/v1/agents/:agentId — get agent with balance and task stats
  app.get("/api/v1/agents/:agentId", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const agent = getAgentOrThrow(agentId);
    const profile = getAgentPublicProfile(agentId);
    return reply.send({ success: true, data: { ...profile, balance: agent.balance } });
  });

  // PATCH /api/v1/agents/:agentId — update agent
  app.patch("/api/v1/agents/:agentId", { preHandler: [authRequired] }, async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { balance?: number; stakeAmount?: number };

    if (body.balance !== undefined) {
      updateAgentBalance(agentId, body.balance);
    }
    if (body.stakeAmount !== undefined) {
      updateAgentStake(agentId, body.stakeAmount);
    }

    const agent = getAgentOrThrow(agentId);
    return reply.send({ success: true, data: agent });
  });

  // POST /api/v1/agents/:agentId/address — register blockchain address
  const stellar = createStellarService();
  app.post("/api/v1/agents/:agentId/address", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const body = request.body as { address: string; privateKey: string };

    if (!body.address || !body.privateKey) {
      return reply.status(400).send({ success: false, error: "address and privateKey are required" });
    }

    getAgentOrThrow(agentId); // ensure agent exists
    stellar.registerAddress(agentId, body.address, body.privateKey);

    return reply.send({ success: true, data: { agentId, address: body.address } });
  });

  // GET /api/v1/agents/:agentId/address — get registered blockchain address
  app.get("/api/v1/agents/:agentId/address", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    getAgentOrThrow(agentId);

    const address = stellar.getAddress(agentId);
    return reply.send({ success: true, data: { agentId, address } });
  });
}
