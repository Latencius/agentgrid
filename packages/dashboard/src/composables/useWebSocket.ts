import { onMounted, onUnmounted, ref } from 'vue'
import { useAgentsStore, type AgentStatus } from '../stores/agents'
import { useTasksStore, type TaskStatus } from '../stores/tasks'
import { useMetricsStore, type Score } from '../stores/metrics'

// ──────────────────────────────────────────────
// WS event constants (mirroring orchestrator/src/ws/events.ts)
// ──────────────────────────────────────────────

const WS_EVENTS = {
  AGENT_STATUS: 'agent:status',
  AGENT_LOG: 'agent:log',
  TASK_STATUS: 'task:status',
  SCORE_UPDATED: 'score:updated',
  COST_UPDATED: 'cost:updated',
  AGENT_SEND: 'agent:send',
} as const

// ──────────────────────────────────────────────
// Payload types
// ──────────────────────────────────────────────

interface AgentStatusPayload {
  agentId: string
  status: AgentStatus
}

interface AgentLogPayload {
  agentId: string
  line: string
}

interface TaskStatusPayload {
  taskId: string
  status: TaskStatus
  agentId: string | null
}

interface CostUpdatedPayload {
  agentId: string
  tokensUsed: number
  costUsd: number
}

interface ScoreUpdatedPayload {
  taskId: string
  scores: Score[]
}

interface WsMessage {
  event: string
  data: unknown
}

// ──────────────────────────────────────────────
// Composable
// ──────────────────────────────────────────────

export function useWebSocket() {
  const agentsStore = useAgentsStore()
  const tasksStore = useTasksStore()
  const metricsStore = useMetricsStore()
  const isConnected = ref(false)

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws`
    ws = new WebSocket(url)

    ws.onopen = () => {
      isConnected.value = true
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(event.data) as WsMessage
      } catch {
        return
      }
      handleMessage(msg)
    }

    ws.onclose = () => {
      isConnected.value = false
      reconnectTimer = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function handleMessage(msg: WsMessage): void {
    switch (msg.event) {
      case WS_EVENTS.AGENT_STATUS: {
        const data = msg.data as AgentStatusPayload
        agentsStore.updateAgentStatus(data.agentId, data.status)
        break
      }
      case WS_EVENTS.AGENT_LOG: {
        const data = msg.data as AgentLogPayload
        agentsStore.appendLog(data.agentId, data.line)
        break
      }
      case WS_EVENTS.TASK_STATUS: {
        const data = msg.data as TaskStatusPayload
        tasksStore.updateTaskStatus(data.taskId, data.status, data.agentId)
        break
      }
      case WS_EVENTS.COST_UPDATED: {
        const data = msg.data as CostUpdatedPayload
        agentsStore.updateAgentCost(data.agentId, data.tokensUsed, data.costUsd)
        metricsStore.updateAgentCost(data.agentId, data.tokensUsed, data.costUsd)
        break
      }
      case WS_EVENTS.SCORE_UPDATED: {
        const data = msg.data as ScoreUpdatedPayload
        metricsStore.setScores(data.taskId, data.scores)
        break
      }
    }
  }

  function send(event: string, data: unknown): void {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, data }))
    }
  }

  function sendToAgent(agentId: string, message: string): void {
    send(WS_EVENTS.AGENT_SEND, { agentId, message })
  }

  onMounted(() => {
    connect()
  })

  onUnmounted(() => {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    ws?.close()
  })

  return { isConnected, send, sendToAgent }
}
