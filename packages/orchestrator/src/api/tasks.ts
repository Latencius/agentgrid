import { Router, Request, Response } from 'express'
import {
  createTask,
  getTask,
  getTasks,
  updateTask,
  updateAgent,
  deleteTask,
  getAgent,
  TaskStatus,
} from '../store/db'
import { logger } from '../utils/logger'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function notFound(res: Response, id: string): void {
  res.status(404).json({ error: `Task "${id}" not found` })
}

function param(req: Request, key: string): string {
  const v = req.params[key]
  return Array.isArray(v) ? v[0]! : (v ?? '')
}

const VALID_STATUSES: TaskStatus[] = ['pending', 'running', 'done', 'failed']

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export function createTasksRouter(): Router {
  const router = Router()

  // GET /api/tasks
  router.get('/', (req: Request, res: Response) => {
    const status = req.query['status'] as TaskStatus | undefined
    const agentId = req.query['agent_id'] as string | undefined

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      res.status(400).json({ error: `Invalid status "${status}"` })
      return
    }

    const tasks = getTasks({ status, agent_id: agentId })
    res.json(tasks)
  })

  // POST /api/tasks
  router.post('/', (req: Request, res: Response) => {
    const { title, description, depends_on } = req.body as {
      title?: unknown
      description?: unknown
      depends_on?: unknown
    }

    if (typeof title !== 'string' || title.trim() === '') {
      res.status(400).json({ error: 'title is required' })
      return
    }
    if (depends_on !== undefined && !Array.isArray(depends_on)) {
      res.status(400).json({ error: 'depends_on must be an array' })
      return
    }

    const task = createTask({
      title: title.trim(),
      description: typeof description === 'string' ? description : undefined,
      depends_on: Array.isArray(depends_on) ? (depends_on as string[]) : undefined,
    })
    logger.info('Task created via API', { id: task.id })
    res.status(201).json(task)
  })

  // PATCH /api/tasks/:id
  router.patch('/:id', (req: Request, res: Response) => {
    const task = getTask(param(req, 'id'))
    if (!task) { notFound(res, param(req, 'id')); return }

    const { title, description, status, depends_on } = req.body as {
      title?: unknown
      description?: unknown
      status?: unknown
      depends_on?: unknown
    }

    if (status !== undefined && !VALID_STATUSES.includes(status as TaskStatus)) {
      res.status(400).json({ error: `Invalid status "${status as string}"` })
      return
    }

    const updated = updateTask(task.id, {
      title: typeof title === 'string' ? title : undefined,
      description: typeof description === 'string' ? description : undefined,
      status: typeof status === 'string' ? (status as TaskStatus) : undefined,
      depends_on: Array.isArray(depends_on) ? (depends_on as string[]) : undefined,
    })
    res.json(updated)
  })

  // DELETE /api/tasks/:id
  router.delete('/:id', (req: Request, res: Response) => {
    const existed = deleteTask(param(req, 'id'))
    if (!existed) { notFound(res, param(req, 'id')); return }
    res.status(204).end()
  })

  // POST /api/tasks/:id/assign
  router.post('/:id/assign', (req: Request, res: Response) => {
    const task = getTask(param(req, 'id'))
    if (!task) { notFound(res, param(req, 'id')); return }

    const { agentId } = req.body as { agentId?: unknown }
    if (typeof agentId !== 'string' || agentId.trim() === '') {
      res.status(400).json({ error: 'agentId is required' })
      return
    }

    if (!getAgent(agentId)) {
      res.status(404).json({ error: `Agent "${agentId}" not found` })
      return
    }

    const updated = updateTask(task.id, { agent_id: agentId })
    updateAgent(agentId, { current_task_id: task.id })
    logger.info('Task assigned via API', { taskId: task.id, agentId })
    res.json(updated)
  })

  return router
}
