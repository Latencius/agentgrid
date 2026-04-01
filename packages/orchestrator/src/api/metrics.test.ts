import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { initDb, closeDb, createAgent, createTask, createScore, updateAgent } from '../store/db'
import { createMetricsRouter } from './metrics'

let dbPath: string
let app: express.Application

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `ag-metrics-${Date.now()}.db`)
  initDb(dbPath)
  app = express()
  app.use(express.json())
  app.use('/api', createMetricsRouter())
})

afterEach(() => {
  closeDb()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
})

// ──────────────────────────────────────────────
// GET /api/metrics/cost
// ──────────────────────────────────────────────

describe('GET /api/metrics/cost', () => {
  it('returns zeros when no agents exist', async () => {
    const res = await request(app).get('/api/metrics/cost')
    expect(res.status).toBe(200)
    expect(res.body.totalTokens).toBe(0)
    expect(res.body.totalCostUsd).toBe(0)
    expect(res.body.byAgent).toEqual([])
  })

  it('aggregates cost across multiple agents', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    createAgent({ id: 'w2', type: 'gemini-cli', runner: 'pty' })
    updateAgent('w1', { tokens_used: 1000, cost_usd: 0.02 })
    updateAgent('w2', { tokens_used: 500, cost_usd: 0.01 })

    const res = await request(app).get('/api/metrics/cost')
    expect(res.body.totalTokens).toBe(1500)
    expect(res.body.totalCostUsd).toBeCloseTo(0.03)
    expect(res.body.byAgent).toHaveLength(2)
  })

  it('includes per-agent breakdown', async () => {
    createAgent({ id: 'w1', type: 'claude-code', runner: 'pty' })
    updateAgent('w1', { tokens_used: 200, cost_usd: 0.005 })

    const res = await request(app).get('/api/metrics/cost')
    expect(res.body.byAgent[0]).toMatchObject({
      agentId: 'w1',
      tokensUsed: 200,
      costUsd: 0.005,
    })
  })
})

// ──────────────────────────────────────────────
// GET /api/scores/:taskId
// ──────────────────────────────────────────────

describe('GET /api/scores/:taskId', () => {
  it('returns empty array when no scores exist', async () => {
    const res = await request(app).get('/api/scores/no-such-task')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns scores for a task', async () => {
    createAgent({ id: 'judge', type: 'claude-code', runner: 'sdk' })
    const task = createTask({ title: 'Task to score' })
    createScore({
      task_id: task.id,
      agent_id: 'judge',
      completion: 90,
      quality: 85,
      security: 80,
      ux: 75,
      tests: 70,
      comment: 'Good work',
    })

    const res = await request(app).get(`/api/scores/${task.id}`)
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].completion).toBe(90)
    expect(res.body[0].comment).toBe('Good work')
  })
})
