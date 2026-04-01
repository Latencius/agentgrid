import { exec as execCallback } from 'child_process'
import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import { logger } from '../utils/logger'

const execDefault = promisify(execCallback)

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface WorktreeInfo {
  worktreePath: string
  branch: string
  agentId: string
  taskId: string
}

/** Injectable exec function — makes unit testing easy without spawning git. */
export type ExecFn = (cmd: string, opts?: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>

// ──────────────────────────────────────────────
// WorktreeManager
// ──────────────────────────────────────────────

export class WorktreeManager {
  private readonly repoPath: string
  private readonly worktreesDir: string
  private readonly exec: ExecFn

  constructor(repoPath: string, worktreesDir: string, execFn: ExecFn = execDefault) {
    this.repoPath = path.resolve(repoPath)
    this.worktreesDir = path.resolve(worktreesDir)
    this.exec = execFn
    fs.mkdirSync(this.worktreesDir, { recursive: true })
  }

  // ── Public API ────────────────────────────────

  /**
   * Create a git worktree for an agent/task pair.
   * Branch: `agentgrid/{agentId}/{taskId}`
   * Path:   `{worktreesDir}/{agentId}-{taskId}`
   */
  async create(agentId: string, taskId: string): Promise<WorktreeInfo> {
    const branch = `agentgrid/${agentId}/${taskId}`
    const worktreePath = path.join(this.worktreesDir, `${agentId}-${taskId}`)

    if (fs.existsSync(worktreePath)) {
      logger.warn('Worktree directory already exists — reusing', { worktreePath })
      return { worktreePath, branch, agentId, taskId }
    }

    logger.info('Creating worktree', { agentId, taskId, branch, worktreePath })
    try {
      await this.exec(`git worktree add "${worktreePath}" -b "${branch}"`, {
        cwd: this.repoPath,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to create worktree for ${agentId}/${taskId}: ${message}`)
    }

    logger.info('Worktree created', { worktreePath, branch })
    return { worktreePath, branch, agentId, taskId }
  }

  /**
   * Remove a worktree by its path and delete the associated branch.
   */
  async remove(worktreePath: string): Promise<void> {
    const info = await this.findByPath(worktreePath)

    logger.info('Removing worktree', { worktreePath })
    try {
      await this.exec(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.repoPath,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to remove worktree at ${worktreePath}: ${message}`)
    }

    // Best-effort branch cleanup
    if (info !== null) {
      try {
        await this.exec(`git branch -D "${info.branch}"`, { cwd: this.repoPath })
        logger.info('Branch deleted', { branch: info.branch })
      } catch {
        logger.warn('Could not delete branch (may not exist)', { branch: info.branch })
      }
    }

    logger.info('Worktree removed', { worktreePath })
  }

  /**
   * List all agentgrid-managed worktrees by scanning the worktrees directory.
   * Each subdirectory name is expected to be `{agentId}-{taskId}`.
   */
  async list(): Promise<WorktreeInfo[]> {
    if (!fs.existsSync(this.worktreesDir)) return []

    const entries = fs.readdirSync(this.worktreesDir, { withFileTypes: true })
    const result: WorktreeInfo[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const parsed = this.parseDirName(entry.name)
      if (parsed === null) continue

      const worktreePath = path.join(this.worktreesDir, entry.name)
      result.push({
        worktreePath,
        branch: `agentgrid/${parsed.agentId}/${parsed.taskId}`,
        agentId: parsed.agentId,
        taskId: parsed.taskId,
      })
    }

    return result
  }

  // ── Private helpers ───────────────────────────

  /**
   * Directory name format: `{agentId}-{taskId}`
   * agentId itself may contain hyphens (e.g. "worker-1"),
   * so we split on the LAST hyphen-delimited segment that looks like a UUID.
   *
   * Convention: taskId is a UUID (contains at least one hyphen but matches
   * the 8-4-4-4-12 pattern), everything before the first UUID segment boundary
   * is the agentId.
   *
   * For simplicity: split on first `-` only when agentId has no hyphens,
   * otherwise rely on the UUID pattern in taskId.
   */
  private parseDirName(name: string): { agentId: string; taskId: string } | null {
    // UUID v4 pattern
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const uuidMatch = uuidRe.exec(name)
    if (uuidMatch) {
      const taskId = uuidMatch[0]
      // agentId is everything before the UUID (minus the trailing hyphen)
      const agentId = name.slice(0, uuidMatch.index - 1)
      if (agentId.length > 0) return { agentId, taskId }
    }
    // Fallback: split on first hyphen
    const idx = name.indexOf('-')
    if (idx === -1) return null
    return { agentId: name.slice(0, idx), taskId: name.slice(idx + 1) }
  }

  private async findByPath(worktreePath: string): Promise<WorktreeInfo | null> {
    const entries = await this.list()
    return entries.find((e) => e.worktreePath === path.resolve(worktreePath)) ?? null
  }
}
