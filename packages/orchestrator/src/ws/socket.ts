import http from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import { logger } from '../utils/logger'
import {
  WS_EVENTS,
  ServerMessage,
  AgentStatusPayload,
  AgentLogPayload,
  TaskStatusPayload,
  ScoreUpdatedPayload,
  CostUpdatedPayload,
  AgentSendPayload,
} from './events'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type AgentSendHandler = (payload: AgentSendPayload) => void

export interface SocketServerOptions {
  /** Attach to an existing HTTP server (used when Express is combined). */
  server?: http.Server
  /** Port for a standalone WebSocket server (used when no HTTP server given). */
  port?: number
}

// ──────────────────────────────────────────────
// SocketServer
// ──────────────────────────────────────────────

export class SocketServer {
  private readonly wss: WebSocketServer
  private readonly agentSendHandlers: AgentSendHandler[] = []

  constructor(options: SocketServerOptions = {}) {
    if (options.server) {
      this.wss = new WebSocketServer({ server: options.server })
      logger.info('WebSocket server attached to HTTP server')
    } else {
      const port = options.port ?? 3001
      this.wss = new WebSocketServer({ port })
      logger.info('WebSocket server listening', { port })
    }

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    this.wss.on('error', (err) => logger.error('WebSocket server error', { message: err.message }))
  }

  // ── Emit helpers (server → client) ───────────

  emitAgentStatus(data: AgentStatusPayload): void {
    this.broadcast({ event: WS_EVENTS.AGENT_STATUS, data })
  }

  emitAgentLog(data: AgentLogPayload): void {
    this.broadcast({ event: WS_EVENTS.AGENT_LOG, data })
  }

  emitTaskStatus(data: TaskStatusPayload): void {
    this.broadcast({ event: WS_EVENTS.TASK_STATUS, data })
  }

  emitScoreUpdated(data: ScoreUpdatedPayload): void {
    this.broadcast({ event: WS_EVENTS.SCORE_UPDATED, data })
  }

  emitCostUpdated(data: CostUpdatedPayload): void {
    this.broadcast({ event: WS_EVENTS.COST_UPDATED, data })
  }

  // ── Subscription (client → server) ───────────

  /** Register a handler for `agent:send` messages from clients. */
  onAgentSend(handler: AgentSendHandler): void {
    this.agentSendHandlers.push(handler)
  }

  // ── Lifecycle ────────────────────────────────

  get connectedClients(): number {
    return this.wss.clients.size
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((err) => {
        if (err) {
          logger.error('Error closing WebSocket server', { message: err.message })
          reject(err)
        } else {
          logger.info('WebSocket server closed')
          resolve()
        }
      })
    })
  }

  // ── Private helpers ───────────────────────────

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload, (err) => {
          if (err) logger.warn('Failed to send WS message', { message: err.message })
        })
      }
    }
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const remote = req.socket.remoteAddress ?? 'unknown'
    logger.info('WebSocket client connected', { remote, total: this.wss.clients.size })

    ws.on('message', (raw) => this.handleMessage(raw.toString()))
    ws.on('close', () =>
      logger.info('WebSocket client disconnected', { remote, total: this.wss.clients.size - 1 })
    )
    ws.on('error', (err) =>
      logger.warn('WebSocket client error', { remote, message: err.message })
    )
  }

  private handleMessage(raw: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      logger.warn('Received invalid JSON from WebSocket client', { raw: raw.slice(0, 200) })
      return
    }

    if (!isClientMessage(parsed)) {
      logger.warn('Received unknown event from WebSocket client', { parsed })
      return
    }

    if (parsed.event === WS_EVENTS.AGENT_SEND) {
      for (const handler of this.agentSendHandlers) {
        try {
          handler(parsed.data)
        } catch (err: unknown) {
          logger.error('agent:send handler threw', { message: String(err) })
        }
      }
    }
  }
}

// ──────────────────────────────────────────────
// Type guard for incoming client messages
// ──────────────────────────────────────────────

function isClientMessage(val: unknown): val is { event: string; data: AgentSendPayload } {
  if (typeof val !== 'object' || val === null) return false
  const v = val as Record<string, unknown>
  if (typeof v['event'] !== 'string') return false
  if (typeof v['data'] !== 'object' || v['data'] === null) return false
  return true
}
