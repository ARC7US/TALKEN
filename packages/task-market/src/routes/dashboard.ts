import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request, reply) => {
    const htmlPath = path.resolve(process.cwd(), "packages/dashboard/index.html");
    try {
      const html = fs.readFileSync(htmlPath, "utf-8");
      return reply.type("text/html").send(html);
    } catch {
      return reply.status(404).send({ error: "Dashboard not found" });
    }
  });
}
