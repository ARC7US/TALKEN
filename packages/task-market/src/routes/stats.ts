import type { FastifyInstance } from "fastify";
import { rawGet, rawAll } from "../db/connection.js";

interface CountRow { cnt: number }
interface SumRow { total: number }
interface TaskRow {
  id: string;
  status: string;
  skill: string;
  complexity: number;
  fee: number;
  level: number;
  created_at: string;
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/stats — system overview
  app.get("/api/v1/stats", async (request, reply) => {
    const totalTasks = rawGet<CountRow>("SELECT COUNT(*) as cnt FROM tasks")?.cnt ?? 0;
    const publishedTasks = rawGet<CountRow>("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'published'")?.cnt ?? 0;
    const activeTasks = rawGet<CountRow>("SELECT COUNT(*) as cnt FROM tasks WHERE status IN ('published', 'accepted', 'submitted', 'aggregating', 'verified')")?.cnt ?? 0;
    const settledTasks = rawGet<CountRow>("SELECT COUNT(*) as cnt FROM tasks WHERE status = 'settled'")?.cnt ?? 0;
    const totalAgents = rawGet<CountRow>("SELECT COUNT(*) as cnt FROM agents")?.cnt ?? 0;
    const totalValidators = rawGet<CountRow>("SELECT COUNT(*) as cnt FROM agents WHERE stake_amount > 0")?.cnt ?? 0;
    const totalVolume = rawGet<SumRow>("SELECT COALESCE(SUM(fee), 0) as total FROM settlements")?.total ?? 0;
    const avgQuality = rawGet<{ avg: number | null }>("SELECT AVG(quality_score) as avg FROM tasks WHERE quality_score IS NOT NULL")?.avg ?? 0;

    return reply.send({
      success: true,
      data: {
        totalTasks,
        publishedTasks,
        activeTasks,
        settledTasks,
        totalAgents,
        totalValidators,
        totalVolume,
        avgQuality: Math.round(avgQuality * 1000) / 1000,
      },
    });
  });

  // GET /api/v1/stats/recent — recent task activity
  app.get("/api/v1/stats/recent", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const limit = parseInt(query.limit ?? "10");

    const tasks = rawAll<TaskRow>(
      "SELECT id, status, skill, complexity, fee, level, created_at FROM tasks ORDER BY created_at DESC LIMIT ?",
      [limit]
    );

    return reply.send({ success: true, data: tasks });
  });
}
