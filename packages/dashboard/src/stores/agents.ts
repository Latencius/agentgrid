import { defineStore } from 'pinia'
import { ref } from 'vue'

// ──────────────────────────────────────────────
// Types (mirroring orchestrator/src/store/db.ts)
// ──────────────────────────────────────────────

export type AgentType = 'claude-code' | 'gemini-cli' | 'codex'
export type AgentStatus = 'idle' | 'running' | 'stopped' | 'error'
export type RunnerType = 'pty' | 'sdk'

export interface Agent {
  id: string
  type: AgentType
  runner: RunnerType
  status: AgentStatus
  worktree: string | null
  current_task_id: string | null
  tokens_used: number
  cost_usd: number
  created_at: string
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useAgentsStore = defineStore('agents', () => {
  const agents = ref<Agent[]>([])
  const logs = ref<Record<string, string[]>>({})
  const error = ref<string | null>(null)

  async function fetchAgents(): Promise<void> {
    try {
      const res = await fetch('/api/agents')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      agents.value = (await res.json()) as Agent[]
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  function updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = agents.value.find((a) => a.id === agentId)
    if (agent) agent.status = status
  }

  function updateAgentCost(agentId: string, tokensUsed: number, costUsd: number): void {
    const agent = agents.value.find((a) => a.id === agentId)
    if (agent) {
      agent.tokens_used = tokensUsed
      agent.cost_usd = costUsd
    }
  }

  function appendLog(agentId: string, line: string): void {
    if (!logs.value[agentId]) logs.value[agentId] = []
    logs.value[agentId].push(line)
    // Keep last 500 lines per agent
    if (logs.value[agentId].length > 500) {
      logs.value[agentId] = logs.value[agentId].slice(-500)
    }
  }

  async function startAgent(agentId: string): Promise<void> {
    try {
      await fetch(`/api/agents/${agentId}/start`, { method: 'POST' })
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  async function stopAgent(agentId: string): Promise<void> {
    try {
      await fetch(`/api/agents/${agentId}/stop`, { method: 'POST' })
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  return {
    agents,
    logs,
    error,
    fetchAgents,
    updateAgentStatus,
    updateAgentCost,
    appendLog,
    startAgent,
    stopAgent,
  }
})
