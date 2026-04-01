// ──────────────────────────────────────────────
// WebSocket event name constants (single source of truth)
// ──────────────────────────────────────────────

export const WS_EVENTS = {
  // Server → Client
  AGENT_STATUS: 'agent:status',
  AGENT_LOG: 'agent:log',
  TASK_STATUS: 'task:status',
  SCORE_UPDATED: 'score:updated',
  COST_UPDATED: 'cost:updated',
  // Client → Server
  AGENT_SEND: 'agent:send',
} as const

export type WsEventName = typeof WS_EVENTS[keyof typeof WS_EVENTS]

// ──────────────────────────────────────────────
// Payload types
// ──────────────────────────────────────────────

export interface AgentStatusPayload {
  agentId: string
  status: 'idle' | 'running' | 'stopped' | 'error'
}

export interface AgentLogPayload {
  agentId: string
  line: string
}

export interface TaskStatusPayload {
  taskId: string
  status: 'pending' | 'running' | 'done' | 'failed'
  agentId: string | null
}

export interface ScoreUpdatedPayload {
  taskId: string
  scores: {
    completion: number | null
    quality: number | null
    security: number | null
    ux: number | null
    tests: number | null
    comment: string | null
  }
}

export interface CostUpdatedPayload {
  agentId: string
  tokensUsed: number
  costUsd: number
}

export interface AgentSendPayload {
  agentId: string
  message: string
}

/** Union of all typed server→client messages. */
export type ServerMessage =
  | { event: typeof WS_EVENTS.AGENT_STATUS; data: AgentStatusPayload }
  | { event: typeof WS_EVENTS.AGENT_LOG; data: AgentLogPayload }
  | { event: typeof WS_EVENTS.TASK_STATUS; data: TaskStatusPayload }
  | { event: typeof WS_EVENTS.SCORE_UPDATED; data: ScoreUpdatedPayload }
  | { event: typeof WS_EVENTS.COST_UPDATED; data: CostUpdatedPayload }

/** Union of all typed client→server messages. */
export type ClientMessage =
  | { event: typeof WS_EVENTS.AGENT_SEND; data: AgentSendPayload }
