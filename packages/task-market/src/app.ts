import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { TalkenError } from "@talken/shared";
import { initDb, setDb, rawRun } from "./db/connection.js";
import { taskRoutes } from "./routes/tasks.js";
import { agentRoutes } from "./routes/agents.js";
import { validatorRoutes } from "./routes/validators.js";
import { settlementRoutes } from "./routes/settlements.js";
import { relayRoutes } from "./routes/relay.js";
import { statsRoutes } from "./routes/stats.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { handleWebSocketConnection } from "./websocket/handler.js";
import { checkTimedOutVerifications } from "./services/verification-service.js";
import { cleanupOrphanedData } from "./services/relay-cleanup.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // Register plugins
  await app.register(cors, { origin: true });
  await app.register(websocket);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof TalkenError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request data",
          details: error.errors,
        },
      });
    }

    app.log.error(error);
    return reply.status(500).send({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  // Register routes
  await app.register(taskRoutes);
  await app.register(agentRoutes);
  await app.register(validatorRoutes);
  await app.register(settlementRoutes);
  await app.register(relayRoutes);
  await app.register(statsRoutes);
  await app.register(dashboardRoutes);

  // WebSocket endpoint
  app.get("/ws", { websocket: true }, (socket) => {
    handleWebSocketConnection(socket);
  });

  // Health check
  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // Debug: expire a verification session (for testing timeout)
  app.post("/api/v1/debug/expire-session/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const pastTime = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    rawRun(
      "UPDATE verification_sessions SET expires_at = ? WHERE task_id = ?",
      [pastTime, taskId]
    );
    return reply.send({ success: true, message: `Session for ${taskId} expired` });
  });

  // Debug: trigger timeout check manually
  app.post("/api/v1/debug/check-timeout", async (request, reply) => {
    const cancelled = checkTimedOutVerifications();
    return reply.send({ success: true, cancelled });
  });

  // Initialize database
  const db = await initDb();
  setDb(db);

  // Periodic orphan relay data cleanup every 30 seconds
  setInterval(() => {
    cleanupOrphanedData();
  }, 30_000);

  return app;
}
