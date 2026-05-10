/**
 * TALKEN Relay Server
 * Runs on port 1789. Accepts both WebSocket and HTTP connections.
 * Handles task publishing, matching, and validator assignment.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { ValidatorConfig } from "./config.js";
import { scoreTask, type TaskToScore } from "./scoring-engine.js";

interface ConnectedClient {
  ws: WebSocket;
  address: string;
  role: "publisher" | "executor" | "validator";
  skills: string[];
  reputation: number;
  connectedAt: number;
}

interface Task {
  id: string;
  publisher: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  reward: number;
  skills: string[];
  status: "pending" | "matched" | "executing" | "submitted" | "scoring" | "completed" | "failed";
  executor?: string;
  validators: string[];
  scores: { validator: string; score: number; reason: string }[];
  result?: string;
  createdAt: number;
  deadline: number;
}

export class RelayServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private tasks: Map<string, Task> = new Map();
  private config: ValidatorConfig;
  private port: number;

  constructor(config: ValidatorConfig, port = 1789) {
    this.config = config;
    this.port = port;
  }

  start(): void {
    // HTTP server for REST API (plugin uses httpx)
    const httpServer = createServer((req, res) => this.handleHttp(req, res));

    // WebSocket server upgrades from HTTP
    this.wss = new WebSocketServer({ server: httpServer });

    httpServer.listen(this.port, () => {
      console.log(`Relay server listening on port ${this.port} (HTTP + WebSocket)`);
    });

    this.wss.on("connection", (ws: WebSocket) => {
      ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(ws, msg);
        } catch (e: any) {
          this.send(ws, { error: `Invalid message: ${e.message}` });
        }
      });

      ws.on("close", () => {
        this.handleDisconnect(ws);
      });
    });
  }

  stop(): void {
    this.wss?.close();
    this.clients.clear();
    console.log("Relay server stopped");
  }

  private handleMessage(ws: WebSocket, msg: any): void {
    const { method, params, id } = msg;

    switch (method) {
      case "register":
        this.handleRegister(ws, params, id);
        break;
      case "publish_task":
        this.handlePublishTask(ws, params, id);
        break;
      case "accept_task":
        this.handleAcceptTask(ws, params, id);
        break;
      case "submit_result":
        this.handleSubmitResult(ws, params, id);
        break;
      case "list_tasks":
        this.handleListTasks(ws, params, id);
        break;
      case "get_status":
        this.handleGetStatus(ws, id);
        break;
      default:
        this.send(ws, { id, error: `Unknown method: ${method}` });
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────

  private handleRegister(ws: WebSocket, params: any, id: number): void {
    const { address, role, skills } = params;
    if (!address || !role) {
      this.send(ws, { id, error: "address and role required" });
      return;
    }

    this.clients.set(address, {
      ws,
      address,
      role,
      skills: skills || [],
      reputation: 0,
      connectedAt: Date.now(),
    });

    this.send(ws, {
      id,
      result: { success: true, address, role },
    });
    console.log(`Client registered: ${address} as ${role}`);
  }

  private handlePublishTask(ws: WebSocket, params: any, id: number): void {
    const { publisher, title, description, acceptance_criteria, reward, skills, deadline } = params;

    if (!publisher || !title || !description || !reward) {
      this.send(ws, { id, error: "Missing required fields" });
      return;
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: Task = {
      id: taskId,
      publisher,
      title,
      description,
      acceptance_criteria: acceptance_criteria || "",
      reward,
      skills: skills || [],
      status: "pending",
      validators: [],
      scores: [],
      createdAt: Date.now(),
      deadline: deadline || Date.now() + 300_000, // default 5 min
    };

    this.tasks.set(taskId, task);

    // Auto-match executor
    this.matchExecutor(task);

    this.send(ws, { id, result: { task_id: taskId, status: task.status } });
    console.log(`Task published: ${taskId} (${title}, ${reward} TALKEN)`);
  }

  private handleAcceptTask(ws: WebSocket, params: any, id: number): void {
    const { task_id, executor } = params;
    const task = this.tasks.get(task_id);

    if (!task) {
      this.send(ws, { id, error: "Task not found" });
      return;
    }
    if (task.status !== "pending" && task.status !== "matched") {
      this.send(ws, { id, error: `Task is ${task.status}, cannot accept` });
      return;
    }

    task.executor = executor;
    task.status = "executing";

    this.send(ws, { id, result: { success: true, task_id } });

    // Notify publisher
    this.notifyClient(task.publisher, {
      method: "task_accepted",
      params: { task_id, executor },
    });
    console.log(`Task ${task_id} accepted by ${executor}`);
  }

  private handleSubmitResult(ws: WebSocket, params: any, id: number): void {
    const { task_id, executor, result } = params;
    const task = this.tasks.get(task_id);

    if (!task) {
      this.send(ws, { id, error: "Task not found" });
      return;
    }
    if (task.executor !== executor) {
      this.send(ws, { id, error: "Not the assigned executor" });
      return;
    }

    task.result = result;
    task.status = "submitted";

    this.send(ws, { id, result: { success: true, task_id } });

    // Assign validators (3+1)
    this.assignValidators(task);
    console.log(`Task ${task_id} result submitted, assigning validators`);
  }

  private handleListTasks(ws: WebSocket, params: any, id: number): void {
    const { filter, address } = params;
    let tasks = Array.from(this.tasks.values());

    switch (filter) {
      case "available":
        tasks = tasks.filter((t) => t.status === "pending" || t.status === "matched");
        break;
      case "my_published":
        tasks = tasks.filter((t) => t.publisher === address);
        break;
      case "my_accepted":
        tasks = tasks.filter((t) => t.executor === address);
        break;
      case "completed":
        tasks = tasks.filter((t) => t.status === "completed");
        break;
    }

    this.send(ws, { id, result: tasks });
  }

  private handleGetStatus(ws: WebSocket, id: number): void {
    this.send(ws, {
      id,
      result: {
        clients: this.clients.size,
        tasks: this.tasks.size,
        uptime: process.uptime(),
      },
    });
  }

  // ── Matching & Validation ─────────────────────────────────────────────

  private matchExecutor(task: Task): void {
    // Find executors with matching skills
    const candidates = Array.from(this.clients.values())
      .filter((c) => c.role === "executor")
      .filter((c) => task.skills.length === 0 || c.skills.some((s) => task.skills.includes(s)))
      .sort((a, b) => b.reputation - a.reputation);

    if (candidates.length === 0) {
      task.status = "pending"; // Wait for executor
      return;
    }

    // Notify top candidates
    for (const candidate of candidates.slice(0, 5)) {
      this.notifyClient(candidate.address, {
        method: "task_available",
        params: {
          task_id: task.id,
          title: task.title,
          reward: task.reward,
          skills: task.skills,
        },
      });
    }

    task.status = "matched";
  }

  private assignValidators(task: Task): void {
    // Find available validators (excluding publisher and executor)
    const candidates = Array.from(this.clients.values())
      .filter((c) => c.role === "validator")
      .filter((c) => c.address !== task.publisher && c.address !== task.executor)
      .sort((a, b) => b.reputation - a.reputation);

    // Need 3+1 (4 total, one is backup)
    const selected = candidates.slice(0, 4);
    task.validators = selected.map((c) => c.address);
    task.status = "scoring";

    // Send scoring request to each validator
    for (const validator of selected) {
      this.notifyClient(validator.address, {
        method: "score_task",
        params: {
          task_id: task.id,
          title: task.title,
          description: task.description,
          acceptance_criteria: task.acceptance_criteria,
          result: task.result,
        },
      });
    }

    console.log(`Task ${task.id}: assigned ${selected.length} validators`);
  }

  // Also score locally using this node's LLM
  async scoreLocally(task: Task): Promise<void> {
    const taskData: TaskToScore = {
      taskId: task.id,
      skill: task.skills[0] || "general",
      description: task.description,
      params: { title: task.title, acceptance_criteria: task.acceptance_criteria },
      executorResult: task.result || "",
    };

    try {
      const result = await scoreTask(this.config, taskData);
      this.handleScoreResult({
        task_id: task.id,
        validator: "self",
        score: result.score,
        reason: result.reason,
      });
    } catch (e: any) {
      console.error(`Local scoring failed: ${e.message}`);
    }
  }

  handleScoreResult(params: any): void {
    const { task_id, validator, score, reason } = params;
    const task = this.tasks.get(task_id);
    if (!task) return;

    task.scores.push({ validator, score, reason });

    // Check if enough scores (need 3)
    if (task.scores.length >= 3) {
      this.finalizeTask(task);
    }
  }

  private finalizeTask(task: Task): void {
    // Remove outlier scores (deviate > 30 from median)
    const sorted = [...task.scores].sort((a, b) => a.score - b.score);
    const median = sorted[Math.floor(sorted.length / 2)].score;
    const filtered = task.scores.filter((s) => Math.abs(s.score - median) <= 30);

    // Average score
    const avgScore = filtered.reduce((sum, s) => sum + s.score, 0) / filtered.length;
    const passed = avgScore >= 60;

    task.status = passed ? "completed" : "failed";

    // Notify publisher
    this.notifyClient(task.publisher, {
      method: "task_result",
      params: {
        task_id: task.id,
        passed,
        score: Math.round(avgScore),
        status: task.status,
      },
    });

    // Notify executor
    if (task.executor) {
      this.notifyClient(task.executor, {
        method: "task_result",
        params: {
          task_id: task.id,
          passed,
          score: Math.round(avgScore),
        },
      });
    }

    console.log(`Task ${task.id} finalized: ${passed ? "PASSED" : "FAILED"} (${Math.round(avgScore)}/100)`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private notifyClient(address: string, message: any): void {
    const client = this.clients.get(address);
    if (client) {
      this.send(client.ws, message);
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    for (const [address, client] of this.clients.entries()) {
      if (client.ws === ws) {
        this.clients.delete(address);
        console.log(`Client disconnected: ${address}`);
        break;
      }
    }
  }

  // ── HTTP API (for plugin httpx calls) ────────────────────────────────

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Talken-Agent-Id, X-Talken-Timestamp, X-Talken-Signature");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${this.port}`);
    const path = url.pathname;

    // Route: GET /health
    if (path === "/health" && req.method === "GET") {
      this.jsonResponse(res, 200, { status: "ok", uptime: process.uptime() });
      return;
    }

    // Route: GET /api/v1/tasks
    if (path === "/api/v1/tasks" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const skill = url.searchParams.get("skill");
      let tasks = Array.from(this.tasks.values());
      if (status) tasks = tasks.filter((t) => t.status === status);
      if (skill) tasks = tasks.filter((t) => t.skills.includes(skill));
      this.jsonResponse(res, 200, { data: tasks });
      return;
    }

    // Route: POST /api/v1/tasks
    if (path === "/api/v1/tasks" && req.method === "POST") {
      this.readBody(req, (body) => {
        const agentId = req.headers["x-talken-agent-id"] as string;
        const params = { ...body, publisher: agentId || body.publisher };
        this.handlePublishTask({ send: () => {} } as any, params, 0);
        const taskId = `task_${Date.now()}`;
        this.jsonResponse(res, 201, { data: { id: taskId, status: "pending" } });
      });
      return;
    }

    // Route: POST /api/v1/tasks/:id/accept
    const acceptMatch = path.match(/^\/api\/v1\/tasks\/(.+)\/accept$/);
    if (acceptMatch && req.method === "POST") {
      const agentId = req.headers["x-talken-agent-id"] as string;
      this.handleAcceptTask({ send: () => {} } as any, { task_id: acceptMatch[1], executor: agentId }, 0);
      this.jsonResponse(res, 200, { data: { success: true } });
      return;
    }

    // Route: POST /api/v1/tasks/:id/submit
    const submitMatch = path.match(/^\/api\/v1\/tasks\/(.+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      this.readBody(req, (body) => {
        const agentId = req.headers["x-talken-agent-id"] as string;
        this.handleSubmitResult({ send: () => {} } as any, { task_id: submitMatch[1], executor: agentId, result: body.result }, 0);
        this.jsonResponse(res, 200, { data: { success: true } });
      });
      return;
    }

    // Route: GET /api/v1/agents/:id
    const agentMatch = path.match(/^\/api\/v1\/agents\/(.+)$/);
    if (agentMatch && req.method === "GET") {
      this.jsonResponse(res, 200, { data: { id: agentMatch[1], balance: 0, stakeAmount: 0, reputation: 0 } });
      return;
    }

    // Route: POST /api/v1/agents (register)
    if (path === "/api/v1/agents" && req.method === "POST") {
      this.readBody(req, (body) => {
        this.jsonResponse(res, 201, { data: { id: body.id, name: body.name, balance: 0, reputation: 0 } });
      });
      return;
    }

    // 404
    this.jsonResponse(res, 404, { error: "Not found" });
  }

  private jsonResponse(res: ServerResponse, status: number, data: any): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private readBody(req: IncomingMessage, callback: (body: any) => void): void {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        callback(JSON.parse(body));
      } catch {
        callback({});
      }
    });
  }
}
