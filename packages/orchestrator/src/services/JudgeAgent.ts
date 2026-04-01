import { execFile } from 'child_process'
import { promisify } from 'util'
import { createScore, Score } from '../store/db'
import { SocketServer } from '../ws/socket'
import { logger } from '../utils/logger'
import type { AgentType } from '../runners/AgentRunner'
import type { RunnerType } from '../runners/RunnerFactory'

const execFileAsync = promisify(execFile)

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface JudgeConfig {
  enabled: boolean
  type: AgentType
  runner: RunnerType
  scoreItems: string[]
}

export interface JudgeParams {
  taskId: string
  taskDescription: string
  agentId: string
  worktree: string
}

interface JudgeResult {
  completion: number
  quality: number
  security: number
  ux: number
  tests: number
  comment: string
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const JUDGE_TIMEOUT_MS = 120_000

/** Agent-type → { cmd, flags } for one-shot (non-interactive) invocation. */
const JUDGE_COMMANDS: Record<AgentType, { cmd: string; flags: string[] }> = {
  'claude-code': { cmd: 'claude', flags: ['--output-format', 'text', '-p'] },
  'gemini-cli': { cmd: 'gemini', flags: ['-p'] },
  'codex': { cmd: 'codex', flags: [] },
}

const DIFF_MAX_BYTES = 8_000

// ──────────────────────────────────────────────
// JudgeAgent
// ──────────────────────────────────────────────

export class JudgeAgent {
  constructor(
    private readonly config: JudgeConfig,
    private readonly socketServer: SocketServer,
  ) {}

  /**
   * Evaluate a completed task by obtaining the git diff from `worktree`,
   * sending it to the configured model, and persisting the score.
   * Returns null if judging is disabled or an unrecoverable error occurs.
   */
  async judge(params: JudgeParams): Promise<Score | null> {
    if (!this.config.enabled) {
      logger.info('JudgeAgent disabled — skipping', { taskId: params.taskId })
      return null
    }

    try {
      const diff = await this.getGitDiff(params.worktree)
      if (!diff.trim()) {
        logger.warn('No git diff found — skipping judge', { taskId: params.taskId })
        return null
      }

      const prompt = this.buildPrompt(params.taskDescription, diff)
      const raw = await this.runModel(prompt)
      const result = this.parseResult(raw)

      const score = createScore({
        task_id: params.taskId,
        agent_id: params.agentId,
        completion: result.completion,
        quality: result.quality,
        security: result.security,
        ux: result.ux,
        tests: result.tests,
        comment: result.comment,
      })

      this.socketServer.emitScoreUpdated({
        taskId: params.taskId,
        scores: {
          completion: score.completion,
          quality: score.quality,
          security: score.security,
          ux: score.ux,
          tests: score.tests,
          comment: score.comment,
        },
      })

      logger.info('Judge completed', { taskId: params.taskId, agentId: params.agentId })
      return score
    } catch (err: unknown) {
      logger.error('JudgeAgent.judge failed', {
        taskId: params.taskId,
        message: String(err),
      })
      return null
    }
  }

  // ── Visible for testing ───────────────────────

  buildPrompt(taskDescription: string, gitDiff: string): string {
    const truncated =
      gitDiff.length > DIFF_MAX_BYTES
        ? gitDiff.slice(0, DIFF_MAX_BYTES) + '\n...(truncated)'
        : gitDiff

    return [
      '以下の git diff を評価してください。',
      '',
      `タスク概要: ${taskDescription}`,
      '',
      '--- diff ---',
      truncated,
      '---',
      '',
      '以下の項目を0-100で採点し、JSONのみで返してください：',
      '{',
      '  "completion": <実装完了度>,',
      '  "quality": <コード品質>,',
      '  "security": <セキュリティ>,',
      '  "ux": <UX/エラー処理>,',
      '  "tests": <テスト・検証>,',
      '  "comment": "<総評 100字以内>"',
      '}',
    ].join('\n')
  }

  parseResult(raw: string): JudgeResult {
    const match = /\{[\s\S]*?\}/m.exec(raw)
    if (!match) {
      throw new Error(`No JSON object found in model output: "${raw.slice(0, 200)}"`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(match[0])
    } catch {
      throw new Error(`Failed to parse JSON from model output: "${match[0].slice(0, 200)}"`)
    }

    if (!isJudgeResult(parsed)) {
      throw new Error(`Unexpected judge result shape: "${match[0].slice(0, 200)}"`)
    }

    return clampScores(parsed)
  }

  // ── Private helpers ───────────────────────────

  private async getGitDiff(worktree: string): Promise<string> {
    try {
      // First try: unstaged changes + staged changes in working tree
      const { stdout: workingDiff } = await execFileAsync(
        'git',
        ['diff', 'HEAD'],
        { cwd: worktree, timeout: 10_000 },
      )
      if (workingDiff.trim()) return workingDiff

      // Fallback: diff of the last commit (if working tree is clean post-commit)
      const { stdout: commitDiff } = await execFileAsync(
        'git',
        ['diff', 'HEAD~1', 'HEAD'],
        { cwd: worktree, timeout: 10_000 },
      )
      return commitDiff
    } catch (err: unknown) {
      logger.warn('Failed to get git diff', { worktree, message: String(err) })
      return ''
    }
  }

  private async runModel(prompt: string): Promise<string> {
    const { cmd, flags } = JUDGE_COMMANDS[this.config.type]
    const args = [...flags, prompt]

    const { stdout } = await execFileAsync(cmd, args, {
      timeout: JUDGE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })

    return stdout
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isJudgeResult(val: unknown): val is JudgeResult {
  if (typeof val !== 'object' || val === null) return false
  const v = val as Record<string, unknown>
  const numericKeys: Array<keyof JudgeResult> = ['completion', 'quality', 'security', 'ux', 'tests']
  for (const key of numericKeys) {
    if (typeof v[key] !== 'number') return false
  }
  return typeof v['comment'] === 'string'
}

/** Ensure each numeric score is clamped to [0, 100]. */
function clampScores(result: JudgeResult): JudgeResult {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))
  return {
    completion: clamp(result.completion),
    quality: clamp(result.quality),
    security: clamp(result.security),
    ux: clamp(result.ux),
    tests: clamp(result.tests),
    comment: result.comment.slice(0, 200),
  }
}
