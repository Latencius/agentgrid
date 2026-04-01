import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { LockManager, LockConflictError } from './LockManager'

let locksDir: string
let manager: LockManager

beforeEach(() => {
  locksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgrid-locks-'))
  manager = new LockManager(locksDir)
})

afterEach(() => {
  fs.rmSync(locksDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ──────────────────────────────────────────────
// acquire
// ──────────────────────────────────────────────

describe('LockManager.acquire()', () => {
  it('creates a .lock file on first acquisition', async () => {
    await manager.acquire('task-1', 'worker-1')
    expect(fs.existsSync(path.join(locksDir, 'task-1.lock'))).toBe(true)
  })

  it('lock file contains correct JSON fields', async () => {
    await manager.acquire('task-1', 'worker-1')
    const raw = fs.readFileSync(path.join(locksDir, 'task-1.lock'), 'utf-8')
    const data = JSON.parse(raw) as { agentId: string; pid: number; lockedAt: string }
    expect(data.agentId).toBe('worker-1')
    expect(data.pid).toBe(process.pid)
    expect(new Date(data.lockedAt).getTime()).toBeGreaterThan(0)
  })

  it('throws LockConflictError when a live lock exists', async () => {
    // Write a lock with the current PID (it is alive)
    const lockData = { agentId: 'worker-2', pid: process.pid, lockedAt: new Date().toISOString() }
    fs.writeFileSync(path.join(locksDir, 'task-1.lock'), JSON.stringify(lockData))

    await expect(manager.acquire('task-1', 'worker-1')).rejects.toThrow(LockConflictError)
  })

  it('reclaims a stale lock (dead PID)', async () => {
    // Write a lock with a PID that cannot possibly be alive (very large number)
    const deadPid = 9_999_999
    const stale = { agentId: 'worker-old', pid: deadPid, lockedAt: new Date().toISOString() }
    fs.writeFileSync(path.join(locksDir, 'task-1.lock'), JSON.stringify(stale))

    const lock = await manager.acquire('task-1', 'worker-1')
    expect(lock.agentId).toBe('worker-1')

    const raw = fs.readFileSync(path.join(locksDir, 'task-1.lock'), 'utf-8')
    const data = JSON.parse(raw) as { agentId: string }
    expect(data.agentId).toBe('worker-1')
  })

  it('ignores a corrupted lock file and acquires', async () => {
    fs.writeFileSync(path.join(locksDir, 'task-1.lock'), 'not-json')
    const lock = await manager.acquire('task-1', 'worker-1')
    expect(lock.taskId).toBe('task-1')
  })
})

// ──────────────────────────────────────────────
// release
// ──────────────────────────────────────────────

describe('Lock.release()', () => {
  it('removes the .lock file on release', async () => {
    const lock = await manager.acquire('task-1', 'worker-1')
    await lock.release()
    expect(fs.existsSync(path.join(locksDir, 'task-1.lock'))).toBe(false)
  })

  it('is idempotent (double-release does not throw)', async () => {
    const lock = await manager.acquire('task-1', 'worker-1')
    await lock.release()
    await expect(lock.release()).resolves.toBeUndefined()
  })
})

// ──────────────────────────────────────────────
// isLocked
// ──────────────────────────────────────────────

describe('LockManager.isLocked()', () => {
  it('returns false when no lock file exists', () => {
    expect(manager.isLocked('task-1')).toBe(false)
  })

  it('returns true when locked by current process', async () => {
    await manager.acquire('task-1', 'worker-1')
    expect(manager.isLocked('task-1')).toBe(true)
  })

  it('returns false for a stale lock (dead PID)', () => {
    const stale = { agentId: 'w', pid: 9_999_999, lockedAt: new Date().toISOString() }
    fs.writeFileSync(path.join(locksDir, 'task-1.lock'), JSON.stringify(stale))
    expect(manager.isLocked('task-1')).toBe(false)
  })

  it('returns false after release', async () => {
    const lock = await manager.acquire('task-1', 'worker-1')
    await lock.release()
    expect(manager.isLocked('task-1')).toBe(false)
  })
})

// ──────────────────────────────────────────────
// getLockData
// ──────────────────────────────────────────────

describe('LockManager.getLockData()', () => {
  it('returns null when not locked', () => {
    expect(manager.getLockData('task-x')).toBeNull()
  })

  it('returns lock data when locked', async () => {
    await manager.acquire('task-1', 'worker-1')
    const data = manager.getLockData('task-1')
    expect(data?.agentId).toBe('worker-1')
    expect(data?.pid).toBe(process.pid)
  })
})

// ──────────────────────────────────────────────
// constructor
// ──────────────────────────────────────────────

describe('LockManager constructor', () => {
  it('creates the locks directory if it does not exist', () => {
    const newDir = path.join(os.tmpdir(), `agentgrid-new-${Date.now()}`)
    expect(fs.existsSync(newDir)).toBe(false)
    new LockManager(newDir)
    expect(fs.existsSync(newDir)).toBe(true)
    fs.rmSync(newDir, { recursive: true })
  })
})
