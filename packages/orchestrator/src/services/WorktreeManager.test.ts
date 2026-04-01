import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { WorktreeManager, type ExecFn } from './WorktreeManager'

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

const REPO = '/fake/repo'
const TASK_UUID = '550e8400-e29b-41d4-a716-446655440000'

let worktreesDir: string
let execMock: ReturnType<typeof vi.fn>
let manager: WorktreeManager

beforeEach(() => {
  worktreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentgrid-wt-'))
  execMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  manager = new WorktreeManager(REPO, worktreesDir, execMock as ExecFn)
})

afterEach(() => {
  fs.rmSync(worktreesDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

// ──────────────────────────────────────────────
// create
// ──────────────────────────────────────────────

describe('WorktreeManager.create()', () => {
  it('calls git worktree add with correct branch and path', async () => {
    const info = await manager.create('worker-1', TASK_UUID)

    expect(execMock).toHaveBeenCalledOnce()
    const [cmd, opts] = execMock.mock.calls[0] as [string, { cwd: string }]
    expect(cmd).toContain('git worktree add')
    expect(cmd).toContain(`agentgrid/worker-1/${TASK_UUID}`)
    expect(opts.cwd).toBe(path.resolve(REPO))

    expect(info.branch).toBe(`agentgrid/worker-1/${TASK_UUID}`)
    expect(info.agentId).toBe('worker-1')
    expect(info.taskId).toBe(TASK_UUID)
  })

  it('returns existing path without calling git if directory exists', async () => {
    const wtPath = path.join(worktreesDir, `worker-1-${TASK_UUID}`)
    fs.mkdirSync(wtPath)

    await manager.create('worker-1', TASK_UUID)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('throws when git worktree add fails', async () => {
    execMock.mockRejectedValueOnce(new Error('not a git repository'))
    await expect(manager.create('worker-1', TASK_UUID)).rejects.toThrow('Failed to create worktree')
  })

  it('worktree path contains agentId and taskId', async () => {
    const info = await manager.create('worker-2', TASK_UUID)
    expect(info.worktreePath).toContain('worker-2')
    expect(info.worktreePath).toContain(TASK_UUID)
  })
})

// ──────────────────────────────────────────────
// remove
// ──────────────────────────────────────────────

describe('WorktreeManager.remove()', () => {
  it('calls git worktree remove and git branch -D', async () => {
    // Pre-create directory so list() can find it
    const wtPath = path.join(worktreesDir, `worker-1-${TASK_UUID}`)
    fs.mkdirSync(wtPath)

    const absPath = path.resolve(wtPath)
    await manager.remove(absPath)

    const calls = execMock.mock.calls as Array<[string, unknown]>
    const cmds = calls.map(([c]) => c)
    expect(cmds.some((c) => c.includes('git worktree remove'))).toBe(true)
    expect(cmds.some((c) => c.includes('git branch -D'))).toBe(true)
  })

  it('throws when git worktree remove fails', async () => {
    execMock.mockRejectedValueOnce(new Error('no such worktree'))
    const absPath = path.join(worktreesDir, `worker-1-${TASK_UUID}`)
    await expect(manager.remove(absPath)).rejects.toThrow('Failed to remove worktree')
  })

  it('does not throw when branch deletion fails (best-effort)', async () => {
    const wtPath = path.join(worktreesDir, `worker-1-${TASK_UUID}`)
    fs.mkdirSync(wtPath)

    // First call (worktree remove) succeeds, second (branch -D) fails
    execMock
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockRejectedValueOnce(new Error('branch not found'))

    await expect(manager.remove(path.resolve(wtPath))).resolves.toBeUndefined()
  })
})

// ──────────────────────────────────────────────
// list
// ──────────────────────────────────────────────

describe('WorktreeManager.list()', () => {
  it('returns empty array when worktrees dir is empty', async () => {
    expect(await manager.list()).toEqual([])
  })

  it('lists directories in the worktrees dir', async () => {
    fs.mkdirSync(path.join(worktreesDir, `worker-1-${TASK_UUID}`))
    const list = await manager.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.agentId).toBe('worker-1')
    expect(list[0]!.taskId).toBe(TASK_UUID)
    expect(list[0]!.branch).toBe(`agentgrid/worker-1/${TASK_UUID}`)
  })

  it('skips non-directory entries', async () => {
    fs.mkdirSync(path.join(worktreesDir, `worker-1-${TASK_UUID}`))
    fs.writeFileSync(path.join(worktreesDir, 'some-file.txt'), '')
    const list = await manager.list()
    expect(list).toHaveLength(1)
  })

  it('lists multiple worktrees', async () => {
    const uuid2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    fs.mkdirSync(path.join(worktreesDir, `worker-1-${TASK_UUID}`))
    fs.mkdirSync(path.join(worktreesDir, `worker-2-${uuid2}`))
    const list = await manager.list()
    expect(list).toHaveLength(2)
  })
})

// ──────────────────────────────────────────────
// constructor
// ──────────────────────────────────────────────

describe('WorktreeManager constructor', () => {
  it('creates the worktrees directory if it does not exist', () => {
    const newDir = path.join(os.tmpdir(), `agentgrid-wt-new-${Date.now()}`)
    expect(fs.existsSync(newDir)).toBe(false)
    new WorktreeManager(REPO, newDir, execMock as ExecFn)
    expect(fs.existsSync(newDir)).toBe(true)
    fs.rmSync(newDir, { recursive: true })
  })
})
