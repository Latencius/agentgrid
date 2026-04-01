import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import os from 'os'
import path from 'path'
import fs from 'fs'
import { initDb, closeDb, createAgent } from '../store/db'
import { createTasksRouter } from './tasks'

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────

let dbPath: string
let app: express.Application

beforeEach(() => {
  dbPath = path.join(os.tmpdir(), `ag-tasks-${Date.now()}.db`)
  initDb(dbPath)
  app = express()
  app.use(express.json())
  app.use('/api/tasks', createTasksRouter())
})

afterEach(() => {
  closeDb()
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
})

// ──────────────────────────────────────────────
// GET /api/tasks
// ──────────────────────────────────────────────

describe('GET /api/tasks', () => {
  it('returns empty array initially', async () => {
    const res = await request(app).get('/api/tasks')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns all tasks', async () => {
    await request(app).post('/api/tasks').send({ title: 'A' })
    await request(app).post('/api/tasks').send({ title: 'B' })
    const res = await request(app).get('/api/tasks')
    expect(res.body).toHaveLength(2)
  })

  it('filters by status', async () => {
    const t = await request(app).post('/api/tasks').send({ title: 'T' })
    await request(app).patch(`/api/tasks/${t.body.id}`).send({ status: 'done' })
    const res = await request(app).get('/api/tasks?status=done')
    expect(res.body).toHaveLength(1)
  })

  it('rejects invalid status filter', async () => {
    const res = await request(app).get('/api/tasks?status=invalid')
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// POST /api/tasks
// ──────────────────────────────────────────────

describe('POST /api/tasks', () => {
  it('creates a task and returns 201', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'My task' })
    expect(res.status).toBe(201)
    expect(res.body.title).toBe('My task')
    expect(res.body.status).toBe('pending')
  })

  it('creates task with description and depends_on', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'T', description: 'desc', depends_on: ['id-1'] })
    expect(res.body.description).toBe('desc')
    expect(res.body.depends_on).toEqual(['id-1'])
  })

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/api/tasks').send({})
    expect(res.status).toBe(400)
  })

  it('returns 400 when title is empty string', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '   ' })
    expect(res.status).toBe(400)
  })

  it('returns 400 when depends_on is not array', async () => {
    const res = await request(app).post('/api/tasks').send({ title: 'T', depends_on: 'bad' })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// PATCH /api/tasks/:id
// ──────────────────────────────────────────────

describe('PATCH /api/tasks/:id', () => {
  it('updates task fields', async () => {
    const { body: created } = await request(app).post('/api/tasks').send({ title: 'Old' })
    const res = await request(app).patch(`/api/tasks/${created.id}`).send({ title: 'New', status: 'running' })
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('New')
    expect(res.body.status).toBe('running')
  })

  it('returns 404 for unknown task', async () => {
    const res = await request(app).patch('/api/tasks/ghost').send({ title: 'X' })
    expect(res.status).toBe(404)
  })

  it('returns 400 for invalid status', async () => {
    const { body: created } = await request(app).post('/api/tasks').send({ title: 'T' })
    const res = await request(app).patch(`/api/tasks/${created.id}`).send({ status: 'bogus' })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// DELETE /api/tasks/:id
// ──────────────────────────────────────────────

describe('DELETE /api/tasks/:id', () => {
  it('deletes a task and returns 204', async () => {
    const { body } = await request(app).post('/api/tasks').send({ title: 'T' })
    const res = await request(app).delete(`/api/tasks/${body.id}`)
    expect(res.status).toBe(204)
  })

  it('returns 404 for unknown task', async () => {
    const res = await request(app).delete('/api/tasks/ghost')
    expect(res.status).toBe(404)
  })
})

// ──────────────────────────────────────────────
// POST /api/tasks/:id/assign
// ──────────────────────────────────────────────

describe('POST /api/tasks/:id/assign', () => {
  it('assigns an agent to a task', async () => {
    createAgent({ id: 'worker-1', type: 'claude-code', runner: 'pty' })
    const { body: task } = await request(app).post('/api/tasks').send({ title: 'T' })
    const res = await request(app)
      .post(`/api/tasks/${task.id}/assign`)
      .send({ agentId: 'worker-1' })
    expect(res.status).toBe(200)
    expect(res.body.agent_id).toBe('worker-1')
  })

  it('returns 404 when task does not exist', async () => {
    const res = await request(app).post('/api/tasks/ghost/assign').send({ agentId: 'w1' })
    expect(res.status).toBe(404)
  })

  it('returns 404 when agent does not exist', async () => {
    const { body: task } = await request(app).post('/api/tasks').send({ title: 'T' })
    const res = await request(app).post(`/api/tasks/${task.id}/assign`).send({ agentId: 'ghost' })
    expect(res.status).toBe(404)
  })

  it('returns 400 when agentId is missing', async () => {
    const { body: task } = await request(app).post('/api/tasks').send({ title: 'T' })
    const res = await request(app).post(`/api/tasks/${task.id}/assign`).send({})
    expect(res.status).toBe(400)
  })
})
