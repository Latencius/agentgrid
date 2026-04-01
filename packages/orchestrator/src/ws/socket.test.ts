import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { WebSocket } from 'ws'
import { SocketServer } from './socket'
import { WS_EVENTS } from './events'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

let port = 49200

function nextPort(): number {
  return port++
}

function connectClient(p: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${p}`)
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
}

function waitMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once('message', (raw) => {
      try {
        resolve(JSON.parse(raw.toString()))
      } catch {
        reject(new Error(`Non-JSON message: ${raw}`))
      }
    })
  })
}

function waitClose(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.once('close', resolve))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

let server: SocketServer
let p: number

beforeEach(() => {
  p = nextPort()
  server = new SocketServer({ port: p })
})

afterEach(async () => {
  await server.close()
})

// ──────────────────────────────────────────────
// Connection
// ──────────────────────────────────────────────

describe('connection', () => {
  it('accepts a WebSocket connection', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)
    expect(server.connectedClients).toBe(1)
    ws.close()
    await waitClose(ws)
  })

  it('tracks multiple clients', async () => {
    const ws1 = connectClient(p)
    const ws2 = connectClient(p)
    await Promise.all([waitOpen(ws1), waitOpen(ws2)])
    expect(server.connectedClients).toBe(2)
    ws1.close()
    ws2.close()
    await Promise.all([waitClose(ws1), waitClose(ws2)])
  })
})

// ──────────────────────────────────────────────
// Broadcast helpers (server → client)
// ──────────────────────────────────────────────

describe('emitAgentStatus()', () => {
  it('broadcasts agent:status to connected clients', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)
    const msgPromise = waitMessage(ws)
    server.emitAgentStatus({ agentId: 'worker-1', status: 'running' })
    const msg = await msgPromise
    expect(msg).toEqual({ event: WS_EVENTS.AGENT_STATUS, data: { agentId: 'worker-1', status: 'running' } })
    ws.close()
  })
})

describe('emitAgentLog()', () => {
  it('broadcasts agent:log to connected clients', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)
    const msgPromise = waitMessage(ws)
    server.emitAgentLog({ agentId: 'worker-1', line: 'Hello from agent' })
    const msg = await msgPromise
    expect(msg).toEqual({ event: WS_EVENTS.AGENT_LOG, data: { agentId: 'worker-1', line: 'Hello from agent' } })
    ws.close()
  })
})

describe('emitTaskStatus()', () => {
  it('broadcasts task:status to connected clients', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)
    const msgPromise = waitMessage(ws)
    server.emitTaskStatus({ taskId: 'task-1', status: 'done', agentId: 'worker-1' })
    const msg = await msgPromise
    expect(msg).toEqual({ event: WS_EVENTS.TASK_STATUS, data: { taskId: 'task-1', status: 'done', agentId: 'worker-1' } })
    ws.close()
  })
})

describe('emitScoreUpdated()', () => {
  it('broadcasts score:updated to connected clients', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)
    const msgPromise = waitMessage(ws)
    const scores = { completion: 90, quality: 80, security: 70, ux: 85, tests: 75, comment: 'Good' }
    server.emitScoreUpdated({ taskId: 'task-1', scores })
    const msg = await msgPromise
    expect(msg).toEqual({ event: WS_EVENTS.SCORE_UPDATED, data: { taskId: 'task-1', scores } })
    ws.close()
  })
})

describe('emitCostUpdated()', () => {
  it('broadcasts cost:updated to connected clients', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)
    const msgPromise = waitMessage(ws)
    server.emitCostUpdated({ agentId: 'worker-1', tokensUsed: 1500, costUsd: 0.05 })
    const msg = await msgPromise
    expect(msg).toEqual({ event: WS_EVENTS.COST_UPDATED, data: { agentId: 'worker-1', tokensUsed: 1500, costUsd: 0.05 } })
    ws.close()
  })
})

describe('broadcast to multiple clients', () => {
  it('delivers the message to all connected clients', async () => {
    const ws1 = connectClient(p)
    const ws2 = connectClient(p)
    await Promise.all([waitOpen(ws1), waitOpen(ws2)])

    const p1 = waitMessage(ws1)
    const p2 = waitMessage(ws2)
    server.emitAgentStatus({ agentId: 'worker-1', status: 'idle' })

    const [m1, m2] = await Promise.all([p1, p2])
    expect(m1).toEqual(m2)
    ws1.close()
    ws2.close()
  })
})

// ──────────────────────────────────────────────
// Client → Server: agent:send
// ──────────────────────────────────────────────

describe('onAgentSend()', () => {
  it('calls registered handler when client sends agent:send', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)

    const received: Array<{ agentId: string; message: string }> = []
    server.onAgentSend((payload) => received.push(payload))

    ws.send(JSON.stringify({ event: WS_EVENTS.AGENT_SEND, data: { agentId: 'worker-1', message: 'hello' } }))

    await sleep(50)
    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ agentId: 'worker-1', message: 'hello' })
    ws.close()
  })

  it('calls multiple registered handlers', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)

    const handlerA = vi.fn()
    const handlerB = vi.fn()
    server.onAgentSend(handlerA)
    server.onAgentSend(handlerB)

    ws.send(JSON.stringify({ event: WS_EVENTS.AGENT_SEND, data: { agentId: 'w1', message: 'msg' } }))

    await sleep(50)
    expect(handlerA).toHaveBeenCalledOnce()
    expect(handlerB).toHaveBeenCalledOnce()
    ws.close()
  })

  it('ignores malformed JSON from client', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)

    const handler = vi.fn()
    server.onAgentSend(handler)

    ws.send('not-valid-json')
    await sleep(50)
    expect(handler).not.toHaveBeenCalled()
    ws.close()
  })

  it('ignores messages with unknown event names', async () => {
    const ws = connectClient(p)
    await waitOpen(ws)

    const handler = vi.fn()
    server.onAgentSend(handler)

    ws.send(JSON.stringify({ event: 'unknown:event', data: {} }))
    await sleep(50)
    expect(handler).not.toHaveBeenCalled()
    ws.close()
  })
})

// ──────────────────────────────────────────────
// close()
// ──────────────────────────────────────────────

describe('close()', () => {
  it('resolves without error', async () => {
    const s = new SocketServer({ port: nextPort() })
    await expect(s.close()).resolves.toBeUndefined()
  })
})
