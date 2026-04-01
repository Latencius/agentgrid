import fs from 'fs'
import path from 'path'
import { Router, Request, Response } from 'express'
import { getAgents, getScoresByTaskId } from '../store/db'

// ──────────────────────────────────────────────
// Config helpers
// ──────────────────────────────────────────────

interface CostConfig {
  alertThreshold: number
  stopThreshold: number
}

const COST_DEFAULTS: CostConfig = { alertThreshold: 18, stopThreshold: 20 }

function readCostConfig(): CostConfig {
  try {
    const configPath = path.resolve('agentgrid.config.json')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const cfg = JSON.parse(raw) as { cost?: { alertThreshold?: unknown; stopThreshold?: unknown } }
    return {
      alertThreshold:
        typeof cfg.cost?.alertThreshold === 'number'
          ? cfg.cost.alertThreshold
          : COST_DEFAULTS.alertThreshold,
      stopThreshold:
        typeof cfg.cost?.stopThreshold === 'number'
          ? cfg.cost.stopThreshold
          : COST_DEFAULTS.stopThreshold,
    }
  } catch {
    return COST_DEFAULTS
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function param(req: Request, key: string): string {
  const v = req.params[key]
  return Array.isArray(v) ? v[0]! : (v ?? '')
}

// ──────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────

export function createMetricsRouter(): Router {
  const router = Router()

  // GET /api/metrics/cost
  router.get('/metrics/cost', (_req: Request, res: Response) => {
    const agents = getAgents()
    const totalTokens = agents.reduce((sum, a) => sum + a.tokens_used, 0)
    const totalCostUsd = agents.reduce((sum, a) => sum + a.cost_usd, 0)
    const { alertThreshold, stopThreshold } = readCostConfig()

    res.json({
      totalTokens,
      totalCostUsd,
      alertThreshold,
      stopThreshold,
      byAgent: agents.map((a) => ({
        agentId: a.id,
        tokensUsed: a.tokens_used,
        costUsd: a.cost_usd,
      })),
    })
  })

  // GET /api/scores/:taskId
  router.get('/scores/:taskId', (req: Request, res: Response) => {
    const scores = getScoresByTaskId(param(req, 'taskId'))
    res.json(scores)
  })

  return router
}
