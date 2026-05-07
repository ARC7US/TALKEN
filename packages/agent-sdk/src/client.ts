import type {
  Task,
  Agent,
  Settlement,
  VerificationVote,
  ConsensusOutcome,
  AgentPublicProfile,
} from "@talken/shared";
import { Keyring } from "./keyring.js";
import { parseIntent, extractFee, extractDescription } from "./nl-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole = "publisher" | "executor" | "validator";

export interface TalkenClientOptions {
  /** Server base URL, e.g. "http://localhost:3001" */
  baseUrl: string;
  /** Unique agent ID */
  agentId: string;
  /** Polling interval in ms (default 3000) */
  pollInterval?: number;
  /** Skills this agent can handle (for executor matching) */
  skills?: string[];
  /** Keyring for request signing. If omitted, a new one is created (unsigned mode). */
  keyring?: Keyring;
}

/** Callback when a new task is available for execution */
export type TaskAvailableCallback = (task: Task) => void;

/** Callback when a verification request arrives */
export type VerificationRequestCallback = (taskId: string, task: Task) => void;

/** Callback when task status changes (via WebSocket) */
export type TaskEventCallback = (event: string, data: unknown) => void;

// ---------------------------------------------------------------------------
// API response envelope
// ---------------------------------------------------------------------------

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

// ---------------------------------------------------------------------------
// TalkenClient
// ---------------------------------------------------------------------------

export class TalkenClient {
  readonly baseUrl: string;
  readonly agentId: string;
  readonly keyring: Keyring;

  private pollInterval: number;
  private skills: string[];
  private role: AgentRole | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private wsListeners: Map<string, Set<(event: string, data: unknown) => void>> = new Map();
  private knownTaskIds: Set<string> = new Set();
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsReconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectBaseDelay = 1000;

  // Callbacks
  private onTaskAvailable: TaskAvailableCallback | null = null;
  private onVerificationRequest: VerificationRequestCallback | null = null;

  constructor(options: TalkenClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.agentId = options.agentId;
    this.pollInterval = options.pollInterval ?? 3000;
    this.skills = options.skills ?? [];
    this.keyring = options.keyring ?? new Keyring();
  }

  // ── HTTP helpers ────────────────────────────────────────────────────────

  async request<T>(method: string, path: string, body?: unknown, overrideAgentId?: string): Promise<T> {
    const agentId = overrideAgentId ?? this.agentId;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const timestamp = Date.now().toString();

    const headers: Record<string, string> = {
      "X-Talken-Agent-Id": agentId,
      "X-Talken-Timestamp": timestamp,
    };

    if (bodyStr !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    // Sign if keyring has a key for this agent
    if (this.keyring.hasKey(agentId)) {
      const apiPath = `/api/v1${path}`;
      const signature = await this.keyring.sign(agentId, method, apiPath, timestamp, bodyStr);
      headers["X-Talken-Signature"] = signature;
    }

    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers,
      body: bodyStr,
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${method} ${path}: ${JSON.stringify(json)}`);
    }
    const envelope = json as ApiResponse<T>;
    return envelope.data;
  }

  // ── Role management ─────────────────────────────────────────────────────

  setRole(role: AgentRole): void {
    if (this.pollTimer) this.stop();
    this.role = role;
    this.knownTaskIds.clear();
  }

  getRole(): AgentRole | null {
    return this.role;
  }

  // ── Publisher methods ───────────────────────────────────────────────────

  async publishTask(input: {
    skill: string;
    params: Record<string, unknown>;
    fee: number;
    complexity?: number;
    ttl?: number;
  }): Promise<Task> {
    return this.request<Task>("POST", "/tasks", input);
  }

  async confirmTask(taskId: string): Promise<{ task: Task; settlement: Settlement }> {
    return this.request("POST", `/tasks/${taskId}/confirm`);
  }

  async rejectTask(taskId: string): Promise<Task> {
    return this.request("POST", `/tasks/${taskId}/reject`);
  }

  // ── Executor methods ────────────────────────────────────────────────────

  async listTasks(filters?: {
    status?: string;
    skill?: string;
    publisherId?: string;
    executorId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Task[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.skill) params.set("skill", filters.skill);
    if (filters?.publisherId) params.set("publisherId", filters.publisherId);
    if (filters?.executorId) params.set("executorId", filters.executorId);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return this.request<Task[]>("GET", `/tasks${qs ? "?" + qs : ""}`);
  }

  async acceptTask(taskId: string): Promise<Task> {
    return this.request<Task>("POST", `/tasks/${taskId}/accept`);
  }

  async submitResult(
    taskId: string,
    result: Record<string, unknown>,
  ): Promise<{ task: Task; validators: string[] }> {
    return this.request("POST", `/tasks/${taskId}/submit`, { result });
  }

  // ── Validator methods ───────────────────────────────────────────────────

  async stake(amount: number): Promise<Agent> {
    return this.request<Agent>("POST", "/validators/stake", { amount });
  }

  async unstake(amount: number): Promise<Agent> {
    return this.request<Agent>("POST", "/validators/unstake", { amount });
  }

  async voteOnTask(
    taskId: string,
    passed: boolean,
  ): Promise<{
    vote: VerificationVote;
    outcome: ConsensusOutcome | null;
    task?: Task;
    aggregating?: boolean;
    aggregatorId?: string;
    blindVotes?: Array<{ blindId: string; passed: boolean }>;
  }> {
    return this.request("POST", `/tasks/${taskId}/verify`, { passed });
  }

  async aggregateTask(
    taskId: string,
    aggregatorId?: string,
  ): Promise<{ task: Task; outcome: ConsensusOutcome }> {
    return this.request("POST", `/tasks/${taskId}/aggregate`, undefined, aggregatorId);
  }

  async listValidators(): Promise<AgentPublicProfile[]> {
    return this.request<AgentPublicProfile[]>("GET", "/validators");
  }

  // ── Agent methods ───────────────────────────────────────────────────────

  /**
   * Register this agent. If keyring has a key, sends the public key.
   * If no key exists, generates one first.
   */
  async register(input?: {
    name?: string;
    skills?: string[];
  }): Promise<Agent> {
    // Ensure we have a key pair
    if (!this.keyring.hasKey(this.agentId)) {
      this.keyring.generate(this.agentId);
    }

    const publicKey = this.keyring.getPublicKey(this.agentId)!;

    return this.request<Agent>("POST", "/agents", {
      id: this.agentId,
      name: input?.name ?? this.agentId,
      skills: input?.skills ?? this.skills,
      publicKey,
    });
  }

  async getProfile(agentId?: string): Promise<Agent & AgentPublicProfile> {
    return this.request("GET", `/agents/${agentId ?? this.agentId}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>("GET", `/tasks/${taskId}`);
  }

  // ── Heartbeat / Polling ─────────────────────────────────────────────────

  start(): void {
    if (!this.role) throw new Error("Set role first with setRole() before calling start()");
    if (this.pollTimer) return;

    this.connectWs();
    this.seedKnownTasks().then(() => {
      this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
      this.poll();
    });
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.disconnectWs();
    this.knownTaskIds.clear();
  }

  isRunning(): boolean {
    return this.pollTimer !== null;
  }

  // ── Callback registration ───────────────────────────────────────────────

  onNewTask(callback: TaskAvailableCallback): void {
    this.onTaskAvailable = callback;
  }

  onVerification(callback: VerificationRequestCallback): void {
    this.onVerificationRequest = callback;
  }

  // ── Internal: polling logic ─────────────────────────────────────────────

  private async seedKnownTasks(): Promise<void> {
    try {
      if (this.role === "executor") {
        const tasks = await this.listTasks({ status: "published", limit: 100 });
        for (const t of tasks) this.knownTaskIds.add(t.id);
      } else if (this.role === "validator") {
        const tasks = await this.listTasks({ status: "submitted", limit: 100 });
        for (const t of tasks) this.knownTaskIds.add(t.id);
      }
    } catch {
      // Server might not be up yet
    }
  }

  private poll(): void {
    if (this.role === "executor") this.pollExecutor();
    else if (this.role === "validator") this.pollValidator();
  }

  private async pollExecutor(): Promise<void> {
    try {
      const tasks = await this.listTasks({ status: "published" });
      for (const task of tasks) {
        if (this.knownTaskIds.has(task.id)) continue;
        if (this.skills.length > 0 && !this.skills.includes(task.skill)) {
          this.knownTaskIds.add(task.id);
          continue;
        }
        this.knownTaskIds.add(task.id);
        if (this.onTaskAvailable) this.onTaskAvailable(task);
      }
    } catch {
      // Non-fatal
    }
  }

  private async pollValidator(): Promise<void> {
    try {
      const tasks = await this.listTasks({ status: "submitted" });
      for (const task of tasks) {
        if (this.knownTaskIds.has(task.id)) continue;
        this.knownTaskIds.add(task.id);
        if (this.onVerificationRequest) this.onVerificationRequest(task.id, task);
      }
    } catch {
      // Non-fatal
    }
  }

  // ── Internal: WebSocket ─────────────────────────────────────────────────

  private connectWs(): void {
    try {
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + "/ws";
      this.ws = new WebSocket(wsUrl);

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          const channel: string = msg.channel ?? "global";
          const subs = this.wsListeners.get(channel);
          if (subs) for (const cb of subs) cb(msg.event, msg.data);
          const allSubs = this.wsListeners.get("*");
          if (allSubs) for (const cb of allSubs) cb(msg.event, msg.data);
        } catch {
          // ignore
        }
      };

      this.ws.onopen = () => {
        this.wsReconnectAttempts = 0;
        this.ws?.send(JSON.stringify({ type: "subscribe", channel: "tasks" }));
        if (this.role === "publisher") {
          this.ws?.send(JSON.stringify({ type: "subscribe", channel: this.agentId }));
        }
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      // WebSocket is optional
    }
  }

  private scheduleReconnect(): void {
    if (this.wsReconnectAttempts >= this.maxReconnectAttempts) return;
    if (!this.pollTimer) return; // stopped, don't reconnect

    const delay = this.reconnectBaseDelay * Math.pow(2, this.wsReconnectAttempts);
    this.wsReconnectAttempts++;

    this.wsReconnectTimer = setTimeout(() => {
      this.wsReconnectTimer = null;
      this.connectWs();
    }, delay);
  }

  private disconnectWs(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    this.wsReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsListeners.clear();
  }

  subscribe(channel: string, callback: (event: string, data: unknown) => void): void {
    if (!this.wsListeners.has(channel)) this.wsListeners.set(channel, new Set());
    this.wsListeners.get(channel)!.add(callback);
  }

  // ── Natural Language Interface ──────────────────────────────────────────

  /**
   * Handle a natural language message from the user.
   * Parses intent and executes the corresponding action.
   *
   * @returns A human-readable response string
   */
  async handleNaturalLanguage(input: string): Promise<string> {
    const parsed = parseIntent(input);

    switch (parsed.intent) {
      case "switch_role": {
        const role = parsed.role!;
        this.setRole(role);
        this.start();
        return `已切换到 ${role} 模式并开始运行`;
      }

      case "check_balance": {
        const profile = await this.getProfile();
        return `余额: ${profile.balance} TALKEN | 质押: ${profile.stakeAmount} | 声誉: ${profile.reputation}`;
      }

      case "list_tasks": {
        const tasks = await this.listTasks({ status: "published", limit: 10 });
        if (tasks.length === 0) return "当前没有可用的任务";
        return tasks.map((t, i) => `${i + 1}. [${t.id}] ${t.skill} - 费用 ${t.fee} TALKEN`).join("\n");
      }

      case "publish_task": {
        const fee = extractFee(input) ?? 10;
        const description = extractDescription(input) ?? input;
        const skill = parsed.params?.skill ?? "search";
        const task = await this.publishTask({
          skill,
          params: { description },
          fee,
        });
        return `任务已发布: ${task.id} (${skill}, ${fee} TALKEN)`;
      }

      case "accept_task": {
        const tasks = await this.listTasks({ status: "published", limit: 1 });
        if (tasks.length === 0) return "当前没有可接取的任务";
        const task = await this.acceptTask(tasks[0].id);
        return `已接取任务: ${task.id} (${task.skill})`;
      }

      case "vote": {
        const tasks = await this.listTasks({ status: "submitted", limit: 1 });
        if (tasks.length === 0) return "当前没有需要投票的任务";
        const passed = !/不通过|fail|reject/i.test(input);
        const result = await this.voteOnTask(tasks[0].id, passed);
        return `已投票: ${passed ? "通过" : "不通过"} (任务 ${tasks[0].id})`;
      }

      default:
        return "我不太理解你的意思。你可以试试：\n- '切换到 executor 模式'\n- '查看余额'\n- '发布一个搜索任务'\n- '接取任务'";
    }
  }

  // ── Error retry helper ──────────────────────────────────────────────────

  /**
   * Execute an async function with retry on failure.
   */
  async withRetry<T>(fn: () => Promise<T>, maxRetries = 3, delayMs = 1000): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (i < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)));
        }
      }
    }
    throw lastError;
  }
}
