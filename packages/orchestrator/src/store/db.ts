import Database from 'better-sqlite3'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { logger } from '../utils/logger'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed'
export type AgentType = 'claude-code' | 'gemini-cli' | 'codex'
export type AgentStatus = 'idle' | 'running' | 'stopped' | 'error'
export type RunnerType = 'pty' | 'sdk'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  agent_id: string | null
  depends_on: string[] | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface CreateTaskInput {
  title: string
  description?: string
  depends_on?: string[]
}

export interface UpdateTaskInput {
  title?: string
  description?: string
  status?: TaskStatus
  agent_id?: string | null
  depends_on?: string[]
  started_at?: string | null
  finished_at?: string | null
}

export interface Agent {
  id: string
  type: AgentType
  runner: RunnerType
  status: AgentStatus
  worktree: string | null
  current_task_id: string | null
  tokens_used: number
  cost_usd: number
  created_at: string
}

export interface CreateAgentInput {
  id: string
  type: AgentType
  runner: RunnerType
}

export interface UpdateAgentInput {
  status?: AgentStatus
  worktree?: string | null
  current_task_id?: string | null
  tokens_used?: number
  cost_usd?: number
}

export interface Score {
  id: string
  task_id: string
  agent_id: string
  completion: number | null
  quality: number | null
  security: number | null
  ux: number | null
  tests: number | null
  comment: string | null
  judged_at: string
}

export interface CreateScoreInput {
  task_id: string
  agent_id: string
  completion?: number
  quality?: number
  security?: number
  ux?: number
  tests?: number
  comment?: string
}

export interface Log {
  id: number
  agent_id: string
  task_id: string | null
  content: string
  created_at: string
}

export interface CreateLogInput {
  agent_id: string
  task_id?: string
  content: string
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

let _db: Database.Database | null = null

function getDb(): Database.Database {
  if (_db === null) {
    throw new Error('Database is not initialized. Call initDb() first.')
  }
  return _db
}

function serializeDependsOn(depends_on: string[] | undefined | null): string | null {
  if (!depends_on || depends_on.length === 0) return null
  return JSON.stringify(depends_on)
}

function deserializeDependsOn(raw: string | null): string[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as string[]
    return null
  } catch {
    return null
  }
}

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row['id'] as string,
    title: row['title'] as string,
    description: (row['description'] as string | null) ?? null,
    status: row['status'] as TaskStatus,
    agent_id: (row['agent_id'] as string | null) ?? null,
    depends_on: deserializeDependsOn(row['depends_on'] as string | null),
    created_at: row['created_at'] as string,
    started_at: (row['started_at'] as string | null) ?? null,
    finished_at: (row['finished_at'] as string | null) ?? null,
  }
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row['id'] as string,
    type: row['type'] as AgentType,
    runner: row['runner'] as RunnerType,
    status: row['status'] as AgentStatus,
    worktree: (row['worktree'] as string | null) ?? null,
    current_task_id: (row['current_task_id'] as string | null) ?? null,
    tokens_used: (row['tokens_used'] as number) ?? 0,
    cost_usd: (row['cost_usd'] as number) ?? 0,
    created_at: row['created_at'] as string,
  }
}

// ──────────────────────────────────────────────
// Initialization
// ──────────────────────────────────────────────

export function initDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath ?? path.resolve('.agentgrid', 'agentgrid.db')
  logger.info('Initializing SQLite database', { path: resolvedPath })

  const db = new Database(resolvedPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'pending',
      agent_id    TEXT,
      depends_on  TEXT,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at  DATETIME,
      finished_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS agents (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL,
      runner          TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'idle',
      worktree        TEXT,
      current_task_id TEXT,
      tokens_used     INTEGER DEFAULT 0,
      cost_usd        REAL DEFAULT 0.0,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scores (
      id          TEXT PRIMARY KEY,
      task_id     TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      completion  INTEGER,
      quality     INTEGER,
      security    INTEGER,
      ux          INTEGER,
      tests       INTEGER,
      comment     TEXT,
      judged_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );

    CREATE TABLE IF NOT EXISTS logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id    TEXT NOT NULL,
      task_id     TEXT,
      content     TEXT NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  _db = db
  logger.info('Database initialized successfully')
  return db
}

export function closeDb(): void {
  if (_db !== null) {
    _db.close()
    _db = null
    logger.info('Database connection closed')
  }
}

// ──────────────────────────────────────────────
// Task CRUD
// ──────────────────────────────────────────────

export function createTask(input: CreateTaskInput): Task {
  const db = getDb()
  const id = uuidv4()
  db.prepare(`
    INSERT INTO tasks (id, title, description, status, depends_on)
    VALUES (@id, @title, @description, 'pending', @depends_on)
  `).run({
    id,
    title: input.title,
    description: input.description ?? null,
    depends_on: serializeDependsOn(input.depends_on),
  })
  logger.info('Task created', { id, title: input.title })
  return getTask(id) as Task
}

export function getTask(id: string): Task | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  if (!row) return null
  return rowToTask(row as Record<string, unknown>)
}

export function getTasks(filter?: { status?: TaskStatus; agent_id?: string }): Task[] {
  const db = getDb()
  let query = 'SELECT * FROM tasks'
  const conditions: string[] = []
  const params: Record<string, string> = {}

  if (filter?.status) {
    conditions.push('status = @status')
    params['status'] = filter.status
  }
  if (filter?.agent_id !== undefined) {
    conditions.push('agent_id = @agent_id')
    params['agent_id'] = filter.agent_id
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY created_at ASC'

  const rows = db.prepare(query).all(params) as Record<string, unknown>[]
  return rows.map(rowToTask)
}

export function updateTask(id: string, input: UpdateTaskInput): Task | null {
  const db = getDb()
  const fields: string[] = []
  const params: Record<string, unknown> = { id }

  if (input.title !== undefined) { fields.push('title = @title'); params['title'] = input.title }
  if (input.description !== undefined) { fields.push('description = @description'); params['description'] = input.description }
  if (input.status !== undefined) { fields.push('status = @status'); params['status'] = input.status }
  if ('agent_id' in input) { fields.push('agent_id = @agent_id'); params['agent_id'] = input.agent_id ?? null }
  if (input.depends_on !== undefined) { fields.push('depends_on = @depends_on'); params['depends_on'] = serializeDependsOn(input.depends_on) }
  if ('started_at' in input) { fields.push('started_at = @started_at'); params['started_at'] = input.started_at ?? null }
  if ('finished_at' in input) { fields.push('finished_at = @finished_at'); params['finished_at'] = input.finished_at ?? null }

  if (fields.length === 0) return getTask(id)

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`).run(params)
  logger.info('Task updated', { id, fields: Object.keys(input) })
  return getTask(id)
}

export function deleteTask(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  logger.info('Task deleted', { id, deleted: result.changes > 0 })
  return result.changes > 0
}

// ──────────────────────────────────────────────
// Agent CRUD
// ──────────────────────────────────────────────

export function createAgent(input: CreateAgentInput): Agent {
  const db = getDb()
  db.prepare(`
    INSERT INTO agents (id, type, runner, status)
    VALUES (@id, @type, @runner, 'idle')
  `).run(input)
  logger.info('Agent created', { id: input.id })
  return getAgent(input.id) as Agent
}

export function getAgent(id: string): Agent | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
  if (!row) return null
  return rowToAgent(row as Record<string, unknown>)
}

export function getAgents(): Agent[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM agents ORDER BY created_at ASC').all() as Record<string, unknown>[]
  return rows.map(rowToAgent)
}

export function updateAgent(id: string, input: UpdateAgentInput): Agent | null {
  const db = getDb()
  const fields: string[] = []
  const params: Record<string, unknown> = { id }

  if (input.status !== undefined) { fields.push('status = @status'); params['status'] = input.status }
  if ('worktree' in input) { fields.push('worktree = @worktree'); params['worktree'] = input.worktree ?? null }
  if ('current_task_id' in input) { fields.push('current_task_id = @current_task_id'); params['current_task_id'] = input.current_task_id ?? null }
  if (input.tokens_used !== undefined) { fields.push('tokens_used = @tokens_used'); params['tokens_used'] = input.tokens_used }
  if (input.cost_usd !== undefined) { fields.push('cost_usd = @cost_usd'); params['cost_usd'] = input.cost_usd }

  if (fields.length === 0) return getAgent(id)

  db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = @id`).run(params)
  logger.info('Agent updated', { id, fields: Object.keys(input) })
  return getAgent(id)
}

export function deleteAgent(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  logger.info('Agent deleted', { id, deleted: result.changes > 0 })
  return result.changes > 0
}

// ──────────────────────────────────────────────
// Score CRUD
// ──────────────────────────────────────────────

export function createScore(input: CreateScoreInput): Score {
  const db = getDb()
  const id = uuidv4()
  db.prepare(`
    INSERT INTO scores (id, task_id, agent_id, completion, quality, security, ux, tests, comment)
    VALUES (@id, @task_id, @agent_id, @completion, @quality, @security, @ux, @tests, @comment)
  `).run({
    id,
    task_id: input.task_id,
    agent_id: input.agent_id,
    completion: input.completion ?? null,
    quality: input.quality ?? null,
    security: input.security ?? null,
    ux: input.ux ?? null,
    tests: input.tests ?? null,
    comment: input.comment ?? null,
  })
  logger.info('Score created', { id, task_id: input.task_id })
  return getScoreById(id) as Score
}

export function getScoreById(id: string): Score | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM scores WHERE id = ?').get(id)
  if (!row) return null
  return row as Score
}

export function getScoresByTaskId(taskId: string): Score[] {
  const db = getDb()
  return db.prepare('SELECT * FROM scores WHERE task_id = ? ORDER BY judged_at DESC').all(taskId) as Score[]
}

// ──────────────────────────────────────────────
// Log CRUD
// ──────────────────────────────────────────────

export function insertLog(input: CreateLogInput): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO logs (agent_id, task_id, content)
    VALUES (@agent_id, @task_id, @content)
  `).run({
    agent_id: input.agent_id,
    task_id: input.task_id ?? null,
    content: input.content,
  })
}

export function getLogsByAgent(agentId: string, limit = 200): Log[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM logs WHERE agent_id = ? ORDER BY id DESC LIMIT ?')
    .all(agentId, limit) as Log[]
}

export function getLogsByTask(taskId: string, limit = 200): Log[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM logs WHERE task_id = ? ORDER BY id ASC LIMIT ?')
    .all(taskId, limit) as Log[]
}
