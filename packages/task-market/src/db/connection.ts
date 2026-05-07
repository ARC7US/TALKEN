import initSqlJs, { type Database } from "sql.js";
import fs from "node:fs";
import path from "node:path";

let db: Database;

export function getDb(): Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

export function setDb(database: Database): void {
  db = database;
}

export async function initDb(): Promise<Database> {
  const SQL = await initSqlJs();

  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "talken.db");
  let initialData: Buffer | undefined;
  if (fs.existsSync(dbPath)) {
    initialData = fs.readFileSync(dbPath);
  }

  db = initialData ? new SQL.Database(initialData) : new SQL.Database();

  // Create tables
  rawRun(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      publisher_id TEXT NOT NULL,
      executor_id TEXT,
      skill TEXT NOT NULL,
      params TEXT NOT NULL,
      result TEXT,
      complexity REAL NOT NULL,
      fee REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'published',
      ttl INTEGER NOT NULL,
      signature TEXT NOT NULL,
      quality_score REAL,
      consensus_result INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      skills TEXT NOT NULL,
      public_key TEXT,
      stake_amount REAL NOT NULL DEFAULT 0,
      reputation REAL NOT NULL DEFAULT 1.0,
      balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  // Migration: add public_key column if missing
  try {
    rawRun("ALTER TABLE agents ADD COLUMN public_key TEXT", []);
  } catch {
    // Column already exists
  }

  rawRun(`
    CREATE TABLE IF NOT EXISTS verification_votes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      validator_id TEXT NOT NULL,
      passed INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      publisher_id TEXT NOT NULL,
      executor_id TEXT NOT NULL,
      fee_transfer REAL NOT NULL,
      mint_reward REAL NOT NULL,
      validator_rewards TEXT NOT NULL,
      tx_hash TEXT NOT NULL,
      settled_at TEXT NOT NULL
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS stakes (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      unbonded_at TEXT
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS verification_sessions (
      task_id TEXT PRIMARY KEY,
      selected_validators TEXT NOT NULL,
      fallback_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  // Migration: add aggregator_id column if missing
  try {
    rawRun("ALTER TABLE verification_sessions ADD COLUMN aggregator_id TEXT", []);
  } catch {
    // Column already exists
  }

  rawRun(`
    CREATE TABLE IF NOT EXISTS aggregation_sessions (
      task_id TEXT PRIMARY KEY,
      aggregator_id TEXT NOT NULL,
      blind_votes TEXT NOT NULL,
      outcome TEXT,
      created_at TEXT NOT NULL
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS commit_votes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      validator_id TEXT NOT NULL,
      vote_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS reveal_votes (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      validator_id TEXT NOT NULL,
      passed INTEGER NOT NULL,
      secret TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  rawRun(`
    CREATE TABLE IF NOT EXISTS relay_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      data_type TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      stored_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  // Migration: add relay_data index if missing
  try {
    rawRun("CREATE INDEX idx_relay_task_type ON relay_data(task_id, data_type)", []);
  } catch {
    // Index already exists
  }

  // Migration: add level column to tasks if missing
  try {
    rawRun("ALTER TABLE tasks ADD COLUMN level INTEGER NOT NULL DEFAULT 1", []);
  } catch {
    // Column already exists
  }

  // Migration: add parent_task_id column to tasks if missing
  try {
    rawRun("ALTER TABLE tasks ADD COLUMN parent_task_id TEXT", []);
  } catch {
    // Column already exists
  }

  // Migration: add depth column to tasks if missing
  try {
    rawRun("ALTER TABLE tasks ADD COLUMN depth INTEGER NOT NULL DEFAULT 0", []);
  } catch {
    // Column already exists
  }

  rawRun(`
    CREATE TABLE IF NOT EXISTS agent_addresses (
      agent_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed agents if empty
  const agentCount = rawGet<{ cnt: number }>("SELECT COUNT(*) as cnt FROM agents");
  if (agentCount && agentCount.cnt === 0) {
    const now = new Date().toISOString();
    rawRun(
      "INSERT INTO agents (id, name, skills, stake_amount, reputation, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["publisher_1", "Publisher One", JSON.stringify(["search", "code"]), 0, 1.0, 1000, now, now]
    );
    rawRun(
      "INSERT INTO agents (id, name, skills, stake_amount, reputation, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["executor_1", "Executor One", JSON.stringify(["search", "code", "analyze"]), 0, 1.0, 100, now, now]
    );
    rawRun(
      "INSERT INTO agents (id, name, skills, stake_amount, reputation, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["validator_1", "Validator One", JSON.stringify(["verify"]), 200, 1.0, 500, now, now]
    );
    rawRun(
      "INSERT INTO agents (id, name, skills, stake_amount, reputation, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["validator_2", "Validator Two", JSON.stringify(["verify"]), 200, 1.0, 500, now, now]
    );
    rawRun(
      "INSERT INTO agents (id, name, skills, stake_amount, reputation, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ["validator_3", "Validator Three", JSON.stringify(["verify"]), 200, 1.0, 500, now, now]
    );

    // Seed stakes for validators
    rawRun(
      "INSERT INTO stakes (id, agent_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ["stake_v1", "validator_1", 200, "active", now]
    );
    rawRun(
      "INSERT INTO stakes (id, agent_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ["stake_v2", "validator_2", 200, "active", now]
    );
    rawRun(
      "INSERT INTO stakes (id, agent_id, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ["stake_v3", "validator_3", 200, "active", now]
    );
  }

  // Periodic save every 10 seconds
  setInterval(() => {
    saveDb();
  }, 10_000);

  // Save on process exit
  const saveAndExit = () => {
    saveDb();
    process.exit(0);
  };
  process.on("exit", () => saveDb());
  process.on("SIGINT", saveAndExit);
  process.on("SIGTERM", saveAndExit);

  return db;
}

export function saveDb(): void {
  if (!db) return;
  const dataDir = path.resolve(process.cwd(), "data");
  const dbPath = path.join(dataDir, "talken.db");
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function rawRun(sql: string, params: unknown[] = []): void {
  const database = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database.run(sql, params as any);
}

export function rawGet<T>(sql: string, params: unknown[] = []): T | undefined {
  const database = getDb();
  const stmt = database.prepare(sql);
  stmt.bind(params as Parameters<typeof stmt.bind>[0]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row as unknown as T;
  }
  stmt.free();
  return undefined;
}

export function rawAll<T>(sql: string, params: unknown[] = []): T[] {
  const database = getDb();
  const results: T[] = [];
  const stmt = database.prepare(sql);
  stmt.bind(params as Parameters<typeof stmt.bind>[0]);
  while (stmt.step()) {
    results.push(stmt.getAsObject() as unknown as T);
  }
  stmt.free();
  return results;
}
