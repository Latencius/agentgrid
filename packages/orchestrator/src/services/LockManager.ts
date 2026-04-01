import fs from 'fs'
import path from 'path'
import { logger } from '../utils/logger'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface LockData {
  agentId: string
  pid: number
  lockedAt: string
}

export interface Lock {
  taskId: string
  agentId: string
  release(): Promise<void>
}

export class LockConflictError extends Error {
  constructor(taskId: string, holder: LockData) {
    super(
      `Task "${taskId}" is locked by agent "${holder.agentId}" (pid ${holder.pid}, since ${holder.lockedAt})`
    )
    this.name = 'LockConflictError'
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 does not send a signal, only checks if the process exists.
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// ──────────────────────────────────────────────
// LockManager
// ──────────────────────────────────────────────

export class LockManager {
  private readonly locksDir: string

  constructor(locksDir: string) {
    this.locksDir = locksDir
    fs.mkdirSync(locksDir, { recursive: true })
  }

  // ── Public API ────────────────────────────────

  /**
   * Acquire a lock for a task.
   *
   * - If no lock exists → creates one and returns it.
   * - If a stale lock exists (dead PID) → reclaims it.
   * - If a live lock exists → throws LockConflictError.
   */
  async acquire(taskId: string, agentId: string): Promise<Lock> {
    const lockPath = this.lockPath(taskId)

    const existing = this.readLockFile(lockPath)
    if (existing !== null) {
      if (isPidAlive(existing.pid)) {
        throw new LockConflictError(taskId, existing)
      }
      logger.warn('Reclaiming stale lock', { taskId, stalePid: existing.pid })
      fs.unlinkSync(lockPath)
    } else if (fs.existsSync(lockPath)) {
      // Corrupted / unreadable lock file — remove it so we can create a fresh one
      logger.warn('Removing corrupted lock file', { lockPath })
      fs.unlinkSync(lockPath)
    }

    const data: LockData = {
      agentId,
      pid: process.pid,
      lockedAt: new Date().toISOString(),
    }
    fs.writeFileSync(lockPath, JSON.stringify(data, null, 2), { flag: 'wx' })
    logger.info('Lock acquired', { taskId, agentId, pid: process.pid })

    return this.makeLock(taskId, agentId, lockPath)
  }

  /**
   * Returns true if the task is currently locked by a live process.
   */
  isLocked(taskId: string): boolean {
    const data = this.readLockFile(this.lockPath(taskId))
    if (data === null) return false
    return isPidAlive(data.pid)
  }

  /**
   * Returns the lock data for a task, or null if not locked.
   */
  getLockData(taskId: string): LockData | null {
    return this.readLockFile(this.lockPath(taskId))
  }

  // ── Private helpers ───────────────────────────

  private lockPath(taskId: string): string {
    return path.join(this.locksDir, `${taskId}.lock`)
  }

  private readLockFile(lockPath: string): LockData | null {
    if (!fs.existsSync(lockPath)) return null
    try {
      const raw = fs.readFileSync(lockPath, 'utf-8')
      const parsed: unknown = JSON.parse(raw)
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'agentId' in parsed &&
        'pid' in parsed &&
        'lockedAt' in parsed
      ) {
        return parsed as LockData
      }
      logger.warn('Corrupted lock file — ignoring', { lockPath })
      return null
    } catch {
      logger.warn('Failed to read lock file — ignoring', { lockPath })
      return null
    }
  }

  private makeLock(taskId: string, agentId: string, lockPath: string): Lock {
    return {
      taskId,
      agentId,
      release: async () => {
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath)
          logger.info('Lock released', { taskId, agentId })
        }
      },
    }
  }
}
