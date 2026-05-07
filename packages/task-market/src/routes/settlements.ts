import type { FastifyInstance } from "fastify";
import { getSettlement, listSettlements } from "../services/settlement-service.js";

export async function settlementRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/settlements/:taskId — get settlement for task
  app.get("/api/v1/settlements/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const settlement = getSettlement(taskId);

    if (!settlement) {
      return reply.status(404).send({
        success: false,
        error: { code: "SETTLEMENT_NOT_FOUND", message: `Settlement not found for task: ${taskId}` },
      });
    }

    return reply.send({ success: true, data: settlement });
  });

  // GET /api/v1/settlements — list all settlements
  app.get("/api/v1/settlements", async (request, reply) => {
    const settlements = listSettlements();
    return reply.send({ success: true, data: settlements });
  });
}
