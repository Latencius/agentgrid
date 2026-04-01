import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface Score {
  id: string
  task_id: string
  agent_id: string
  completion: number | null
  quality: number | null
  security: number | null
  ux: number | null
  tests: number | null
  comment: string | null
  judged_at: string
}

export interface AgentCost {
  agentId: string
  tokensUsed: number
  costUsd: number
}

export interface CostData {
  totalCostUsd: number
  totalTokens: number
  alertThreshold: number
  stopThreshold: number
  byAgent: AgentCost[]
}

export type CostLevel = 'ok' | 'warn' | 'stop'

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useMetricsStore = defineStore('metrics', () => {
  // ── Scores ────────────────────────────────────
  const scoresByTask = ref<Record<string, Score[]>>({})

  // ── Cost ──────────────────────────────────────
  const costData = ref<CostData>({
    totalCostUsd: 0,
    totalTokens: 0,
    alertThreshold: 18,
    stopThreshold: 20,
    byAgent: [],
  })

  const error = ref<string | null>(null)

  // ── Computed ──────────────────────────────────

  const costLevel = computed<CostLevel>(() => {
    const { totalCostUsd, alertThreshold, stopThreshold } = costData.value
    if (totalCostUsd >= stopThreshold) return 'stop'
    if (totalCostUsd >= alertThreshold) return 'warn'
    return 'ok'
  })

  const DIMS = ['completion', 'quality', 'security', 'ux', 'tests'] as const

  function avgForTask(taskId: string): number | null {
    const scores = scoresByTask.value[taskId]
    if (!scores || scores.length === 0) return null

    let total = 0
    let count = 0
    for (const score of scores) {
      for (const dim of DIMS) {
        const v = score[dim]
        if (v !== null && v !== undefined) {
          total += v
          count++
        }
      }
    }
    return count > 0 ? Math.round(total / count) : null
  }

  // ── Actions ───────────────────────────────────

  async function fetchCost(): Promise<void> {
    try {
      const res = await fetch('/api/metrics/cost')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      costData.value = (await res.json()) as CostData
      error.value = null
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  /** Called by useWebSocket on cost:updated events. */
  function updateAgentCost(agentId: string, tokensUsed: number, costUsd: number): void {
    const existing = costData.value.byAgent.find((a) => a.agentId === agentId)
    if (existing) {
      existing.tokensUsed = tokensUsed
      existing.costUsd = costUsd
    } else {
      costData.value.byAgent.push({ agentId, tokensUsed, costUsd })
    }
    costData.value.totalCostUsd = costData.value.byAgent.reduce((s, a) => s + a.costUsd, 0)
    costData.value.totalTokens = costData.value.byAgent.reduce((s, a) => s + a.tokensUsed, 0)
  }

  async function fetchScores(taskId: string): Promise<void> {
    try {
      const res = await fetch(`/api/scores/${taskId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      scoresByTask.value = { ...scoresByTask.value, [taskId]: (await res.json()) as Score[] }
      error.value = null
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  /** Called by useWebSocket when a score:updated event arrives. */
  function setScores(taskId: string, scores: Score[]): void {
    scoresByTask.value = { ...scoresByTask.value, [taskId]: scores }
  }

  return {
    scoresByTask,
    costData,
    costLevel,
    error,
    avgForTask,
    fetchCost,
    updateAgentCost,
    fetchScores,
    setScores,
  }
})
