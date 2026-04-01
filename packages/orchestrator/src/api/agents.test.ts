import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { initDb, closeDb, createAgent, createTask } from '../store/db'
import { createAgentsRouter } from './agents'
import type { ApiContext } from './context'
import type { Lock } from '../services/LockManager'

// ──────────────────────────────────────────────
// Mock RunnerFactory so no real process is spawned
// ──────────────────────────────────────────────

const mockRunner = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue(undefined),
  onLog: vi.fn(),
  onFinish: vi.fn(),
  getTokensUsed: vi.fn().mockReturnValue(0),
}
vi.mock('../runners/RunnerFactory', () => ({
  RunnerFactory: { create: vi.fn(() => mockRunner) },
}))

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────

let dbPath: string
let app: express.Application
let ctx: ApiContext

const mockLock: Lock = { taskId: '', agentId: '', release: vi.fn().mockResolvedValue(undefined) }

function makeCtx(): ApiContext {
  return {
    lockManager: { acquire: vi.fn().mockResolvedValue(mockLock), isLocked: vi.fn().mockReturnValue(false), getLockData: vi.fn().mockReturnValue(null) } as unknown as ApiContext['lockManager'],
    worktreeManager: { create: vi.fn().mockResolvedValue({ worktreePath: '/tmp/wt', branch: 'x', agentId: 'w', taskId: 't' }), remove: vi.fn(), list: vi.fn() } as unknown as ApiContext['worktreeManager'],
    socketServer: { emitAgentStatus: vi.fn(), emitAgentLog: vi.fn(), emitTaskStatus: vi.fn(), emitScoreUpdated: vi.fn(), emitCostUpdated: vi.fn(), onAgentSend: vi.fn(), close: vi.fn(), connectedClients: 0 } as unknown as ApiContext['socketServer'],
    activeRunners: new Map(),
  }
}

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `ag-agents-${Date.now()}.db`)
  initDb(dbPath)
  ctx = makeCtx()
  app = express()
  app.use(express.json())
  app.use('/api/agents', createAgentsRouter(ctx))
  vi.clearAllMocks()
  mockRunner.start.mockResolvedValue(undefined)
  mockRunner.stop.mockResolvedValue(undefined)
  mockRunner.send.mockResolvedValue(undefined)
})

afterEach(() => {
  closeDb()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
})

// ──────────────────────────────────────────────
// GET /api/agents
// ──────────────────────────────────────────────

describe('GET /api/agents', () => {
  it('returns empty array initially', async () => {
    const res = await request(app).get('/api/agents')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns created agents', async () => {
    await request(app).post('/api/agents').send({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).get('/api/agents')
    expect(res.body).toHaveLength(1)
    expect(res.body[0].id).toBe('w1')
  })
})

// ──────────────────────────────────────────────
// POST /api/agents
// ──────────────────────────────────────────────

describe('POST /api/agents', () => {
  it('creates an agent and returns 201', async () => {
    const res = await request(app)
      .post('/api/agents')
      .send({ id: 'worker-1', type: 'claude-code', runner: 'pty' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('worker-1')
    expect(res.body.status).toBe('idle')
  })

  it('returns 400 when id is missing', async () => {
    const res = await request(app).post('/api/agents').send({ type: 'claude-code', runner: 'pty' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid type', async () => {
    const res = await request(app).post('/api/agents').send({ id: 'w', type: 'invalid', runner: 'pty' })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid runner', async () => {
    const res = await request(app).post('/api/agents').send({ id: 'w', type: 'claude-code', runner: 'bad' })
    expect(res.status).toBe(400)
  })

  it('returns 409 when agent id already exists', async () => {
    await request(app).post('/api/agents').send({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).post('/api/agents').send({ id: 'w1', type: 'claude-code', runner: 'pty' })
    expect(res.status).toBe(409)
  })
})

// ──────────────────────────────────────────────
// POST /api/agents/:id/start
// ──────────────────────────────────────────────

describe('POST /api/agents/:id/start', () => {
  it('starts an agent and returns updated agent', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const task = createTask({ title: 'Do something' })

    const res = await request(app)
      .post('/api/agents/w1/start')
      .send({ taskId: task.id })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('running')
    expect(ctx.activeRunners.has('w1')).toBe(true)
  })

  it('returns 404 when agent does not exist', async () => {
    const res = await request(app).post('/api/agents/ghost/start').send({ taskId: 'x' })
    expect(res.status).toBe(404)
  })

  it('returns 409 when agent is already running', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const task = createTask({ title: 'T' })
    ctx.activeRunners.set('w1', { runner: mockRunner as never, lock: mockLock })

    // Manually set status to running in DB
    const { updateAgent } = await import('../store/db')
    updateAgent('w1', { status: 'running' })

    const res = await request(app).post('/api/agents/w1/start').send({ taskId: task.id })
    expect(res.status).toBe(409)
  })

  it('returns 400 when no task is provided and none is assigned', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).post('/api/agents/w1/start').send({})
    expect(res.status).toBe(400)
  })

  it('returns 404 when taskId does not exist', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).post('/api/agents/w1/start').send({ taskId: 'no-such' })
    expect(res.status).toBe(404)
  })

  it('returns 409 when lock acquisition fails', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const task = createTask({ title: 'T' })
    vi.mocked(ctx.lockManager.acquire).mockRejectedValueOnce(new Error('locked'))
    const res = await request(app).post('/api/agents/w1/start').send({ taskId: task.id })
    expect(res.status).toBe(409)
  })

  it('emits agent:status and task:status WS events on start', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const task = createTask({ title: 'T' })
    await request(app).post('/api/agents/w1/start').send({ taskId: task.id })
    expect(ctx.socketServer.emitAgentStatus).toHaveBeenCalledWith({ agentId: 'w1', status: 'running' })
    expect(ctx.socketServer.emitTaskStatus).toHaveBeenCalledWith({ taskId: task.id, status: 'running', agentId: 'w1' })
  })
})

// ──────────────────────────────────────────────
// POST /api/agents/:id/stop
// ──────────────────────────────────────────────

describe('POST /api/agents/:id/stop', () => {
  it('stops a running agent', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    ctx.activeRunners.set('w1', { runner: mockRunner as never, lock: mockLock })
    const { updateAgent } = await import('../store/db')
    updateAgent('w1', { status: 'running' })

    const res = await request(app).post('/api/agents/w1/stop')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('stopped')
    expect(ctx.activeRunners.has('w1')).toBe(false)
    expect(mockRunner.stop).toHaveBeenCalled()
  })

  it('returns 404 when agent does not exist', async () => {
    const res = await request(app).post('/api/agents/ghost/stop')
    expect(res.status).toBe(404)
  })

  it('returns 409 when agent is not running', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).post('/api/agents/w1/stop')
    expect(res.status).toBe(409)
  })

  it('emits agent:status WS event on stop', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    ctx.activeRunners.set('w1', { runner: mockRunner as never, lock: mockLock })
    await request(app).post('/api/agents/w1/stop')
    expect(ctx.socketServer.emitAgentStatus).toHaveBeenCalledWith({ agentId: 'w1', status: 'stopped' })
  })
})

// ──────────────────────────────────────────────
// POST /api/agents/:id/message
// ──────────────────────────────────────────────

describe('POST /api/agents/:id/message', () => {
  it('sends message to running agent', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    ctx.activeRunners.set('w1', { runner: mockRunner as never, lock: mockLock })

    const res = await request(app).post('/api/agents/w1/message').send({ message: 'hello' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(mockRunner.send).toHaveBeenCalledWith('hello')
  })

  it('returns 409 when agent is not running', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).post('/api/agents/w1/message').send({ message: 'hi' })
    expect(res.status).toBe(409)
  })

  it('returns 400 when message is empty', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    ctx.activeRunners.set('w1', { runner: mockRunner as never, lock: mockLock })
    const res = await request(app).post('/api/agents/w1/message').send({ message: '' })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// GET /api/agents/:id/logs
// ──────────────────────────────────────────────

describe('GET /api/agents/:id/logs', () => {
  it('returns empty array when no logs exist', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).get('/api/agents/w1/logs')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns 404 when agent does not exist', async () => {
    const res = await request(app).get('/api/agents/ghost/logs')
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid limit', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).get('/api/agents/w1/logs?limit=bad')
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// DELETE /api/agents/:id
// ──────────────────────────────────────────────

describe('DELETE /api/agents/:id', () => {
  it('deletes a stopped agent and returns 204', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    const res = await request(app).delete('/api/agents/w1')
    expect(res.status).toBe(204)
  })

  it('returns 409 when agent is running', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    ctx.activeRunners.set('w1', { runner: mockRunner as never, lock: mockLock })
    const res = await request(app).delete('/api/agents/w1')
    expect(res.status).toBe(409)
  })

  it('returns 404 when agent does not exist', async () => {
    const res = await request(app).delete('/api/agents/ghost')
    expect(res.status).toBe(404)
  })
})
