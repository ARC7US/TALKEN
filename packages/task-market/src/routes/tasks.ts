import type { FastifyInstance } from "fastify";
import { PublishTaskSchema, SubmitResultSchema, VerificationVoteSchema } from "@talken/shared";
import { authRequired } from "../middleware/auth.js";
import {
  createTask,
  getTask,
  getTaskOrThrow,
  listTasks,
  acceptTask,
  submitResult,
  handleVerificationOutcome,
  updateTaskStatus,
  confirmTask,
  rejectTask,
  handleReverifyOutcome,
  expireTask,
  splitTask,
  getSubtasks,
  checkParentCompletion,
} from "../services/task-service.js";
import {
  createVerificationSession,
  castVote,
  tallyVotes,
  allVotesIn,
  startAggregation,
  submitAggregation,
  getBlindVotes,
  getAggregator,
  commitVote,
  allCommitsIn,
  revealVote,
  allRevealsIn,
} from "../services/verification-service.js";
import { executeSettlement } from "../services/settlement-service.js";
import { createStellarService } from "../stellar/index.js";
import { broadcast } from "../websocket/handler.js";

const stellar = createStellarService();

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/v1/tasks — create task
  app.post("/api/v1/tasks", { preHandler: [authRequired] }, async (request, reply) => {
    const body = PublishTaskSchema.parse(request.body);
    const agentId = (request.headers["x-talken-agent-id"] as string) || "publisher_1";

    const task = createTask({
      publisherId: agentId,
      skill: body.skill,
      params: body.params,
      complexity: body.complexity,
      fee: body.fee,
      ttl: body.ttl,
      signature: "sig_mock",
    });

    broadcast(task.id, "task:created", task);
    broadcast("tasks", "task:created", task);

    return reply.status(201).send({ success: true, data: task });
  });

  // GET /api/v1/tasks — list tasks
  app.get("/api/v1/tasks", async (request, reply) => {
    const query = request.query as Record<string, string>;
    const tasks = listTasks({
      status: query.status,
      skill: query.skill,
      publisherId: query.publisherId,
      executorId: query.executorId,
      limit: query.limit ? parseInt(query.limit) : undefined,
      offset: query.offset ? parseInt(query.offset) : undefined,
    });

    return reply.send({ success: true, data: tasks });
  });

  // GET /api/v1/tasks/:taskId — get task detail
  app.get("/api/v1/tasks/:taskId", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const task = getTaskOrThrow(taskId);
    return reply.send({ success: true, data: task });
  });

  // POST /api/v1/tasks/:taskId/accept — executor accepts
  app.post("/api/v1/tasks/:taskId/accept", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const agentId = (request.headers["x-talken-agent-id"] as string) || "executor_1";

    const task = acceptTask(taskId, agentId);
    broadcast(taskId, "task:accepted", task);
    broadcast("tasks", "task:accepted", task);

    return reply.send({ success: true, data: task });
  });

  // POST /api/v1/tasks/:taskId/submit — executor submits result
  app.post("/api/v1/tasks/:taskId/submit", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = SubmitResultSchema.parse(request.body);

    const task = submitResult(taskId, body.result);

    // Auto-create verification session (count based on task level)
    const validators = createVerificationSession(taskId, task.level);
    broadcast(taskId, "task:submitted", { task, validators });
    broadcast("tasks", "task:submitted", { task, validators });

    return reply.send({ success: true, data: { task, validators } });
  });

  // POST /api/v1/tasks/:taskId/verify — validator votes
  app.post("/api/v1/tasks/:taskId/verify", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = VerificationVoteSchema.parse(request.body);
    const validatorId = (request.headers["x-talken-agent-id"] as string) || "validator_1";

    const vote = castVote(taskId, validatorId, body.passed);
    broadcast(taskId, "vote:cast", vote);

    // Check if all 3 validators have voted → start aggregation phase
    if (allVotesIn(taskId)) {
      const { aggregatorId, blindVotes } = startAggregation(taskId);
      const task = updateTaskStatus(taskId, "AGGREGATE");
      broadcast(taskId, "task:aggregating", { task, aggregatorId, blindVotes });
      broadcast("tasks", "task:aggregating", { task, aggregatorId, blindVotes });
      return reply.send({ success: true, data: { vote, outcome: null, aggregating: true, aggregatorId, blindVotes } });
    }

    return reply.send({ success: true, data: { vote, outcome: null } });
  });

  // POST /api/v1/tasks/:taskId/aggregate — aggregator tallies blind votes
  app.post("/api/v1/tasks/:taskId/aggregate", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const aggregatorId = (request.headers["x-talken-agent-id"] as string) || "validator_4";

    const outcome = submitAggregation(taskId, aggregatorId);

    // Transition task based on aggregation result
    const event = outcome.passed ? "VALIDATE_PASS" : "VALIDATE_FAIL";
    const task = handleVerificationOutcome(taskId, outcome.passed, outcome.qualityScore);

    broadcast(taskId, "task:verified", { task, outcome });
    broadcast("tasks", "task:verified", { task, outcome });

    return reply.send({ success: true, data: { task, outcome } });
  });

  // POST /api/v1/tasks/:taskId/confirm — publisher confirms
  app.post("/api/v1/tasks/:taskId/confirm", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    // Confirm task
    const confirmedTask = confirmTask(taskId);

    // Execute settlement directly (already sets task status to "settled")
    const settlement = await executeSettlement(taskId, stellar);

    const task = getTaskOrThrow(taskId);
    broadcast(taskId, "task:settled", { task, settlement });
    broadcast("tasks", "task:settled", { task, settlement });

    return reply.send({ success: true, data: { task, settlement } });
  });

  // POST /api/v1/tasks/:taskId/reject — publisher rejects
  app.post("/api/v1/tasks/:taskId/reject", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };

    const task = rejectTask(taskId);
    broadcast(taskId, "task:rejected", task);
    broadcast("tasks", "task:rejected", task);

    return reply.send({ success: true, data: task });
  });

  // POST /api/v1/tasks/:taskId/split — publisher splits task into subtasks
  app.post("/api/v1/tasks/:taskId/split", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = request.body as { subtasks: Array<{ skill: string; params: Record<string, unknown>; complexity: number; fee: number; ttl: number }> };

    const subtasks = splitTask(taskId, body.subtasks);
    broadcast(taskId, "task:split", { parentTaskId: taskId, subtasks });

    return reply.status(201).send({ success: true, data: { parentTaskId: taskId, subtasks } });
  });

  // GET /api/v1/tasks/:taskId/subtasks — get subtasks of a parent task
  app.get("/api/v1/tasks/:taskId/subtasks", async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const subtasks = getSubtasks(taskId);
    return reply.send({ success: true, data: subtasks });
  });

  // POST /api/v1/tasks/:taskId/commit — Phase 1: commit vote hash
  app.post("/api/v1/tasks/:taskId/commit", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = request.body as { voteHash: string };
    const validatorId = (request.headers["x-talken-agent-id"] as string) || "validator_1";

    commitVote(taskId, validatorId, body.voteHash);
    broadcast(taskId, "vote:committed", { taskId, validatorId });

    // Check if all commits are in
    const allCommitted = allCommitsIn(taskId);

    return reply.send({ success: true, data: { committed: true, allCommitted } });
  });

  // POST /api/v1/tasks/:taskId/reveal — Phase 2: reveal vote
  app.post("/api/v1/tasks/:taskId/reveal", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = request.body as { passed: boolean; secret: string };
    const validatorId = (request.headers["x-talken-agent-id"] as string) || "validator_1";

    revealVote(taskId, validatorId, body.passed, body.secret);
    broadcast(taskId, "vote:revealed", { taskId, validatorId, passed: body.passed });

    // Check if all reveals are in
    const allRevealed = allRevealsIn(taskId);

    return reply.send({ success: true, data: { revealed: true, allRevealed } });
  });

  // POST /api/v1/tasks/:taskId/reverify-outcome — check re-verification
  app.post("/api/v1/tasks/:taskId/reverify-outcome", { preHandler: [authRequired] }, async (request, reply) => {
    const { taskId } = request.params as { taskId: string };
    const body = request.body as { passed: boolean; qualityScore: number };

    const task = handleReverifyOutcome(taskId, body.passed, body.qualityScore);
    broadcast(taskId, "task:reverified", task);
    broadcast("tasks", "task:reverified", task);

    return reply.send({ success: true, data: task });
  });
}
