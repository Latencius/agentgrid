import http from 'http'
import path from 'path'
import express from 'express'
import { initDb } from './store/db'
import { LockManager } from './services/LockManager'
import { WorktreeManager } from './services/WorktreeManager'
import { SocketServer } from './ws/socket'
import { createTasksRouter } from './api/tasks'
import { createAgentsRouter } from './api/agents'
import { createMetricsRouter } from './api/metrics'
import { ApiContext } from './api/context'
import { logger } from './utils/logger'

const PORT = parseInt(process.env['PORT'] ?? '3000', 10)
const AGENTGRID_DIR = path.resolve('.agentgrid')

export function createApp(): { app: express.Application; context: ApiContext } {
  initDb(path.join(AGENTGRID_DIR, 'agentgrid.db'))

  const lockManager = new LockManager(path.join(AGENTGRID_DIR, 'locks'))
  const worktreeManager = new WorktreeManager('./', path.join(AGENTGRID_DIR, 'worktrees'))
  const activeRunners: ApiContext['activeRunners'] = new Map()

  const app = express()
  app.use(express.json())

  // Placeholder SocketServer — replaced with the real one once httpServer is created.
  // We use a factory pattern so the socket can attach to the HTTP server.
  const context: ApiContext = {
    lockManager,
    worktreeManager,
    socketServer: null as unknown as SocketServer, // set below after httpServer exists
    activeRunners,
  }

  app.use('/api/tasks', createTasksRouter())
  app.use('/api/agents', createAgentsRouter(context))
  app.use('/api', createMetricsRouter())

  return { app, context }
}

if (require.main === module) {
  const { app, context } = createApp()
  const httpServer = http.createServer(app)
  context.socketServer = new SocketServer({ server: httpServer })

  // Forward client agent:send events to running runners
  context.socketServer.onAgentSend(({ agentId, message }) => {
    const active = context.activeRunners.get(agentId)
    if (!active) {
      logger.warn('agent:send received for non-running agent', { agentId })
      return
    }
    active.runner.send(message).catch((err: unknown) => {
      logger.error('Failed to send message to agent', { agentId, error: String(err) })
    })
  })

  httpServer.listen(PORT, () => {
    logger.info(`Orchestrator listening on http://localhost:${PORT}`)
  })
}
