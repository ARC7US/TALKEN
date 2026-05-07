import type { FastifyInstance } from "fastify";
import { authRequired } from "../middleware/auth.js";
import { storeData, getData, deleteData } from "../services/relay-service.js";

export async function relayRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/relay/tasks/:taskId/brief — store encrypted task brief
  app.post("/api/v1/relay/tasks/:taskId/brief", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const agentId = request.headers["x-talken-agent-id"] as string;
    const body = request.body as { content: string };

    const relay = storeData(taskId, "brief", body.content, agentId);
    return reply.status(201).send({ success: true, data: relay });
  });

  // GET /api/v1/relay/tasks/:taskId/brief — read decrypted task brief
  app.get("/api/v1/relay/tasks/:taskId/brief", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const agentId = request.headers["x-talken-agent-id"] as string;

    const relay = getData(taskId, "brief", agentId);
    return reply.send({ success: true, data: relay });
  });

  // DELETE /api/v1/relay/tasks/:taskId/brief — delete task brief
  app.delete("/api/v1/relay/tasks/:taskId/brief", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    deleteData(taskId, "brief");
    return reply.send({ success: true, message: "Brief deleted" });
  });

  // POST /api/v1/relay/tasks/:taskId/result — store encrypted result
  app.post("/api/v1/relay/tasks/:taskId/result", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const agentId = request.headers["x-talken-agent-id"] as string;
    const body = request.body as { content: string };

    const relay = storeData(taskId, "result", body.content, agentId);
    return reply.status(201).send({ success: true, data: relay });
  });

  // GET /api/v1/relay/tasks/:taskId/result — read decrypted result
  app.get("/api/v1/relay/tasks/:taskId/result", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const agentId = request.headers["x-talken-agent-id"] as string;

    const relay = getData(taskId, "result", agentId);
    return reply.send({ success: true, data: relay });
  });

  // DELETE /api/v1/relay/tasks/:taskId/result — delete result
  app.delete("/api/v1/relay/tasks/:taskId/result", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    deleteData(taskId, "result");
    return reply.send({ success: true, message: "Result deleted" });
  });
}
