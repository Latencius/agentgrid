import { Router, Request, Response } from 'express'
import {
  createAgent,
  getAgent,
  getAgents,
  updateAgent,
  deleteAgent,
  getTask,
  updateTask,
  insertLog,
  getLogsByAgent,
  AgentType,
} from '../store/db'
import { RunnerFactory, RunnerType } from '../runners/RunnerFactory'
import { logger } from '../utils/logger'
import { ApiContext } from './context'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function notFound(res: Response, entity: string, id: string): void {
  res.status(404).json({ error: `${entity} "${id}" not found` })
}

function param(req: Request, key: string): string {
  const v = req.params[key]
  return Array.isArray(v) ? v[0]! : (v ?? '')
}

const VALID_AGENT_TYPES: AgentType[] = ['claude-code', 'gemini-cli', 'codex']
const VALID_RUNNER_TYPES: RunnerType[] = ['pty', 'sdk']

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export function createAgentsRouter(ctx: ApiContext): Router {
  const { lockManager, worktreeManager, activeRunners } = ctx
  const router = Router()

  // GET /api/agents
  router.get('/', (_req: Request, res: Response) => {
    res.json(getAgents())
  })

  // POST /api/agents
  router.post('/', (req: Request, res: Response) => {
    const { id, type, runner } = req.body as { id?: unknown; type?: unknown; runner?: unknown }

    if (typeof id !== 'string' || id.trim() === '') {
      res.status(400).json({ error: 'id is required' }); return
    }
    if (!VALID_AGENT_TYPES.includes(type as AgentType)) {
      res.status(400).json({ error: `type must be one of: ${VALID_AGENT_TYPES.join(', ')}` }); return
    }
    if (!VALID_RUNNER_TYPES.includes(runner as RunnerType)) {
      res.status(400).json({ error: `runner must be one of: ${VALID_RUNNER_TYPES.join(', ')}` }); return
    }
    if (getAgent(id as string)) {
      res.status(409).json({ error: `Agent "${id as string}" already exists` }); return
    }

    const agent = createAgent({ id: id as string, type: type as AgentType, runner: runner as RunnerType })
    logger.info('Agent created via API', { id: agent.id })
    res.status(201).json(agent)
  })

  // POST /api/agents/:id/start
  router.post('/:id/start', async (req: Request, res: Response) => {
    const agent = getAgent(param(req, 'id'))
    if (!agent) { notFound(res, 'Agent', param(req, 'id')); return }

    if (agent.status === 'running') {
      res.status(409).json({ error: `Agent "${agent.id}" is already running` }); return
    }
    if (activeRunners.has(agent.id)) {
      res.status(409).json({ error: `Agent "${agent.id}" has an active runner` }); return
    }

    const taskId = ((req.body ?? {}) as { taskId?: unknown }).taskId
    const resolvedTaskId = typeof taskId === 'string' ? taskId : agent.current_task_id
    if (!resolvedTaskId) {
      res.status(400).json({ error: 'taskId is required (or assign a task to the agent first)' }); return
    }

    const task = getTask(resolvedTaskId)
    if (!task) { notFound(res, 'Task', resolvedTaskId); return }

    // Acquire task lock
    let lock
    try {
      lock = await lockManager.acquire(task.id, agent.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      res.status(409).json({ error: `Could not acquire lock: ${msg}` }); return
    }

    // Create worktree
    let worktreeInfo
    try {
      worktreeInfo = await worktreeManager.create(agent.id, task.id)
    } catch (err: unknown) {
      await lock.release()
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: `Could not create worktree: ${msg}` }); return
    }

    // Create and start runner
    const runner = RunnerFactory.create({ runner: agent.runner as RunnerType })

    // Wire log → DB + WebSocket
    runner.onLog((line) => {
      insertLog({ agent_id: agent.id, task_id: task.id, content: line })
      ctx.socketServer.emitAgentLog({ agentId: agent.id, line })
    })

    // Wire finish → cleanup
    runner.onFinish(async (exitCode) => {
      const finalStatus = exitCode === 0 ? 'done' : 'failed'
      updateTask(task.id, {
        status: finalStatus,
        finished_at: new Date().toISOString(),
      })
      updateAgent(agent.id, { status: 'idle', current_task_id: null })
      activeRunners.delete(agent.id)

      await lock.release()

      ctx.socketServer.emitTaskStatus({ taskId: task.id, status: finalStatus, agentId: agent.id })
      ctx.socketServer.emitAgentStatus({ agentId: agent.id, status: 'idle' })
      logger.info('Agent finished task', { agentId: agent.id, taskId: task.id, exitCode })
    })

    try {
      await runner.start({
        agentId: agent.id,
        type: agent.type as AgentType,
        worktree: worktreeInfo.worktreePath,
        taskDescription: task.description ?? task.title,
      })
    } catch (err: unknown) {
      await lock.release()
      const msg = err instanceof Error ? err.message : String(err)
      res.status(500).json({ error: `Could not start runner: ${msg}` }); return
    }

    // Persist state
    updateTask(task.id, { status: 'running', started_at: new Date().toISOString(), agent_id: agent.id })
    const updatedAgent = updateAgent(agent.id, {
      status: 'running',
      current_task_id: task.id,
      worktree: worktreeInfo.worktreePath,
    })
    activeRunners.set(agent.id, { runner, lock })

    ctx.socketServer.emitAgentStatus({ agentId: agent.id, status: 'running' })
    ctx.socketServer.emitTaskStatus({ taskId: task.id, status: 'running', agentId: agent.id })

    logger.info('Agent started via API', { agentId: agent.id, taskId: task.id })
    res.json(updatedAgent)
  })

  // POST /api/agents/:id/stop
  router.post('/:id/stop', async (req: Request, res: Response) => {
    const agent = getAgent(param(req, 'id'))
    if (!agent) { notFound(res, 'Agent', param(req, 'id')); return }

    const active = activeRunners.get(agent.id)
    if (!active) {
      res.status(409).json({ error: `Agent "${agent.id}" is not running` }); return
    }

    await active.runner.stop()
    await active.lock.release()
    activeRunners.delete(agent.id)

    const updatedAgent = updateAgent(agent.id, { status: 'stopped' })
    if (agent.current_task_id) {
      updateTask(agent.current_task_id, { status: 'failed', finished_at: new Date().toISOString() })
    }

    ctx.socketServer.emitAgentStatus({ agentId: agent.id, status: 'stopped' })
    logger.info('Agent stopped via API', { agentId: agent.id })
    res.json(updatedAgent)
  })

  // POST /api/agents/:id/message
  router.post('/:id/message', async (req: Request, res: Response) => {
    const agent = getAgent(param(req, 'id'))
    if (!agent) { notFound(res, 'Agent', param(req, 'id')); return }

    const active = activeRunners.get(agent.id)
    if (!active) {
      res.status(409).json({ error: `Agent "${agent.id}" is not running` }); return
    }

    const { message } = req.body as { message?: unknown }
    if (typeof message !== 'string' || message.trim() === '') {
      res.status(400).json({ error: 'message is required' }); return
    }

    await active.runner.send(message)
    logger.info('Message sent to agent via API', { agentId: agent.id })
    res.json({ ok: true })
  })

  // GET /api/agents/:id/logs
  router.get('/:id/logs', (req: Request, res: Response) => {
    const agent = getAgent(param(req, 'id'))
    if (!agent) { notFound(res, 'Agent', param(req, 'id')); return }

    const limitParam = req.query['limit']
    const limit = typeof limitParam === 'string' ? parseInt(limitParam, 10) : 200
    if (isNaN(limit) || limit <= 0) {
      res.status(400).json({ error: 'limit must be a positive integer' }); return
    }

    const logs = getLogsByAgent(agent.id, limit)
    res.json(logs)
  })

  // DELETE /api/agents/:id
  router.delete('/:id', (req: Request, res: Response) => {
    if (activeRunners.has(param(req, 'id'))) {
      res.status(409).json({ error: `Agent "${param(req, 'id')}" is running — stop it first` }); return
    }
    const existed = deleteAgent(param(req, 'id'))
    if (!existed) { notFound(res, 'Agent', param(req, 'id')); return }
    res.status(204).end()
  })

  return router
}
