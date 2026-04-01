import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import {
  initDb,
  closeDb,
  createTask,
  getTask,
  getTasks,
  updateTask,
  deleteTask,
  createAgent,
  getAgent,
  getAgents,
  updateAgent,
  deleteAgent,
  createScore,
  getScoresByTaskId,
  insertLog,
  getLogsByAgent,
  getLogsByTask,
} from './db'

let dbPath: string

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `agentgrid-test-${Date.now()}.db`)
  initDb(dbPath)
})

afterEach(() => {
  closeDb()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
})

// ──────────────────────────────────────────────
// Task CRUD
// ──────────────────────────────────────────────

describe('Task CRUD', () => {
  it('creates a task with defaults', () => {
    const task = createTask({ title: 'Test task' })
    expect(task.id).toBeTruthy()
    expect(task.title).toBe('Test task')
    expect(task.status).toBe('pending')
    expect(task.description).toBeNull()
    expect(task.agent_id).toBeNull()
    expect(task.depends_on).toBeNull()
  })

  it('creates a task with all fields', () => {
    const task = createTask({
      title: 'Full task',
      description: 'desc',
      depends_on: ['id-1', 'id-2'],
    })
    expect(task.description).toBe('desc')
    expect(task.depends_on).toEqual(['id-1', 'id-2'])
  })

  it('getTask returns null for unknown id', () => {
    expect(getTask('no-such-id')).toBeNull()
  })

  it('getTasks returns all tasks', () => {
    createTask({ title: 'A' })
    createTask({ title: 'B' })
    expect(getTasks()).toHaveLength(2)
  })

  it('getTasks filters by status', () => {
    const t = createTask({ title: 'A' })
    updateTask(t.id, { status: 'running' })
    createTask({ title: 'B' })
    const running = getTasks({ status: 'running' })
    expect(running).toHaveLength(1)
    expect(running[0]!.title).toBe('A')
  })

  it('updateTask modifies fields', () => {
    const task = createTask({ title: 'Old' })
    const updated = updateTask(task.id, { title: 'New', status: 'done' })
    expect(updated?.title).toBe('New')
    expect(updated?.status).toBe('done')
  })

  it('updateTask with no fields returns current state', () => {
    const task = createTask({ title: 'Same' })
    const result = updateTask(task.id, {})
    expect(result?.title).toBe('Same')
  })

  it('deleteTask removes the task', () => {
    const task = createTask({ title: 'Delete me' })
    expect(deleteTask(task.id)).toBe(true)
    expect(getTask(task.id)).toBeNull()
  })

  it('deleteTask returns false for unknown id', () => {
    expect(deleteTask('ghost')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// Agent CRUD
// ──────────────────────────────────────────────

describe('Agent CRUD', () => {
  it('creates an agent', () => {
    const agent = createAgent({ id: 'worker-1', type: 'claude-code', runner: 'pty' })
    expect(agent.id).toBe('worker-1')
    expect(agent.status).toBe('idle')
    expect(agent.tokens_used).toBe(0)
    expect(agent.cost_usd).toBe(0)
  })

  it('getAgent returns null for unknown id', () => {
    expect(getAgent('x')).toBeNull()
  })

  it('getAgents returns all agents', () => {
    createAgent({ id: 'a', type: 'claude-code', runner: 'pty' })
    createAgent({ id: 'b', type: 'gemini-cli', runner: 'sdk' })
    expect(getAgents()).toHaveLength(2)
  })

  it('updateAgent updates status and cost', () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const updated = updateAgent('w1', { status: 'running', tokens_used: 500, cost_usd: 0.01 })
    expect(updated?.status).toBe('running')
    expect(updated?.tokens_used).toBe(500)
    expect(updated?.cost_usd).toBe(0.01)
  })

  it('deleteAgent removes the agent', () => {
    createAgent({ id: 'del', type: 'claude-code', runner: 'pty' })
    expect(deleteAgent('del')).toBe(true)
    expect(getAgent('del')).toBeNull()
  })
})

// ──────────────────────────────────────────────
// Score CRUD
// ──────────────────────────────────────────────

describe('Score CRUD', () => {
  it('creates a score and retrieves by task', () => {
    const task = createTask({ title: 'scored task' })
    createAgent({ id: 'judge-1', type: 'claude-code', runner: 'sdk' })
    const score = createScore({
      task_id: task.id,
      agent_id: 'judge-1',
      completion: 90,
      quality: 80,
      security: 75,
      ux: 70,
      tests: 85,
      comment: 'Good work',
    })
    expect(score.completion).toBe(90)
    const scores = getScoresByTaskId(task.id)
    expect(scores).toHaveLength(1)
    expect(scores[0]!.comment).toBe('Good work')
  })

  it('returns empty array for unknown task', () => {
    expect(getScoresByTaskId('no-task')).toEqual([])
  })
})

// ──────────────────────────────────────────────
// Log CRUD
// ──────────────────────────────────────────────

describe('Log CRUD', () => {
  it('inserts and retrieves logs by agent', () => {
    insertLog({ agent_id: 'a1', content: 'line 1' })
    insertLog({ agent_id: 'a1', content: 'line 2' })
    insertLog({ agent_id: 'a2', content: 'other' })
    const logs = getLogsByAgent('a1')
    expect(logs).toHaveLength(2)
  })

  it('retrieves logs by task', () => {
    const task = createTask({ title: 't' })
    insertLog({ agent_id: 'a1', task_id: task.id, content: 'log for task' })
    insertLog({ agent_id: 'a1', content: 'no task' })
    expect(getLogsByTask(task.id)).toHaveLength(1)
  })

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      insertLog({ agent_id: 'a1', content: `line ${i}` })
    }
    expect(getLogsByAgent('a1', 3)).toHaveLength(3)
  })
})
