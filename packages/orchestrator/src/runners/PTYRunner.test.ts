import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as ptyModule from 'node-pty'

// ──────────────────────────────────────────────
// Mock node-pty
// ──────────────────────────────────────────────

interface MockPty {
  write: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  onExit: ReturnType<typeof vi.fn>
  _triggerData: (data: string) => void
  _triggerExit: (exitCode: number) => void
}

function makeMockPty(): MockPty {
  const dataHandlers: Array<(data: string) => void> = []
  const exitHandlers: Array<(ev: { exitCode: number }) => void> = []

  return {
    write: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((cb: (data: string) => void) => { dataHandlers.push(cb) }),
    onExit: vi.fn((cb: (ev: { exitCode: number }) => void) => { exitHandlers.push(cb) }),
    _triggerData: (data) => dataHandlers.forEach((cb) => cb(data)),
    _triggerExit: (code) => exitHandlers.forEach((cb) => cb({ exitCode: code })),
  }
}

let mockPty: MockPty
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => mockPty),
}))

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

import { PTYRunner } from './PTYRunner'
import { RunnerFactory } from './RunnerFactory'

const BASE_CONFIG = {
  agentId: 'worker-1',
  type: 'claude-code' as const,
  worktree: '/tmp/test-worktree',
  taskDescription: 'Build feature X',
}

beforeEach(() => {
  mockPty = makeMockPty()
  vi.mocked(ptyModule.spawn).mockReturnValue(mockPty as unknown as ptyModule.IPty)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PTYRunner.start()', () => {
  it('spawns node-pty with the correct command for claude-code', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)
    expect(ptyModule.spawn).toHaveBeenCalledWith(
      'claude',
      [],
      expect.objectContaining({ cwd: '/tmp/test-worktree' })
    )
  })

  it('uses correct command for gemini-cli', async () => {
    const runner = new PTYRunner()
    await runner.start({ ...BASE_CONFIG, type: 'gemini-cli' })
    expect(ptyModule.spawn).toHaveBeenCalledWith('gemini', [], expect.anything())
  })

  it('uses correct command for codex', async () => {
    const runner = new PTYRunner()
    await runner.start({ ...BASE_CONFIG, type: 'codex' })
    expect(ptyModule.spawn).toHaveBeenCalledWith('codex', [], expect.anything())
  })

  it('throws if called while already running', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)
    await expect(runner.start(BASE_CONFIG)).rejects.toThrow('already running')
  })
})

describe('PTYRunner.onLog()', () => {
  it('emits each line of PTY output to log callbacks', async () => {
    const runner = new PTYRunner()
    const lines: string[] = []
    runner.onLog((line) => lines.push(line))
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('hello world\n')
    mockPty._triggerData('second line\n')

    expect(lines).toEqual(['hello world', 'second line'])
  })

  it('strips ANSI escape codes from output', async () => {
    const runner = new PTYRunner()
    const lines: string[] = []
    runner.onLog((line) => lines.push(line))
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('\x1b[32mGreen text\x1b[0m\n')

    expect(lines).toEqual(['Green text'])
  })

  it('handles partial lines across data events', async () => {
    const runner = new PTYRunner()
    const lines: string[] = []
    runner.onLog((line) => lines.push(line))
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('part1')
    expect(lines).toHaveLength(0)

    mockPty._triggerData(' part2\ncomplete\n')
    expect(lines).toEqual(['part1 part2', 'complete'])
  })

  it('supports multiple log callbacks', async () => {
    const runner = new PTYRunner()
    const a: string[] = []
    const b: string[] = []
    runner.onLog((l) => a.push(l))
    runner.onLog((l) => b.push(l))
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('msg\n')
    expect(a).toEqual(['msg'])
    expect(b).toEqual(['msg'])
  })
})

describe('PTYRunner.onFinish()', () => {
  it('fires finish callbacks with the exit code', async () => {
    const runner = new PTYRunner()
    const codes: number[] = []
    runner.onFinish((code) => codes.push(code))
    await runner.start(BASE_CONFIG)

    mockPty._triggerExit(0)
    expect(codes).toEqual([0])
  })

  it('fires finish callbacks on non-zero exit', async () => {
    const runner = new PTYRunner()
    const codes: number[] = []
    runner.onFinish((code) => codes.push(code))
    await runner.start(BASE_CONFIG)

    mockPty._triggerExit(1)
    expect(codes).toEqual([1])
  })
})

describe('PTYRunner.send()', () => {
  it('writes message with newline to the PTY', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)
    await runner.send('do the task')
    expect(mockPty.write).toHaveBeenCalledWith('do the task\n')
  })

  it('does not double-add newline if message already ends with one', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)
    await runner.send('already\n')
    expect(mockPty.write).toHaveBeenCalledWith('already\n')
  })

  it('throws if process is not running', async () => {
    const runner = new PTYRunner()
    await expect(runner.send('hi')).rejects.toThrow('not running')
  })
})

describe('PTYRunner.stop()', () => {
  it('sends Ctrl+C to the process', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)

    const stopPromise = runner.stop()
    mockPty._triggerExit(0)
    await stopPromise

    expect(mockPty.write).toHaveBeenCalledWith('\x03')
  })

  it('is a no-op when not running', async () => {
    const runner = new PTYRunner()
    await expect(runner.stop()).resolves.toBeUndefined()
  })
})

describe('PTYRunner.getTokensUsed()', () => {
  it('returns 0 before any output', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)
    expect(runner.getTokensUsed()).toBe(0)
  })

  it('parses "Tokens: N input · M output" pattern', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('Tokens: 1,200 input · 300 output\n')
    expect(runner.getTokensUsed()).toBe(1500)
  })

  it('parses "(N tokens)" pattern', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('(450 tokens)\n')
    expect(runner.getTokensUsed()).toBe(450)
  })

  it('accumulates tokens across multiple lines', async () => {
    const runner = new PTYRunner()
    await runner.start(BASE_CONFIG)

    mockPty._triggerData('Tokens: 500 input · 100 output\n')
    mockPty._triggerData('Tokens: 200 input · 50 output\n')
    expect(runner.getTokensUsed()).toBe(850)
  })
})

describe('RunnerFactory', () => {
  it('creates a PTYRunner for runner="pty"', () => {
    const runner = RunnerFactory.create({ runner: 'pty' })
    expect(runner).toBeInstanceOf(PTYRunner)
  })

  it('throws for runner="sdk" (not yet implemented)', () => {
    expect(() => RunnerFactory.create({ runner: 'sdk' })).toThrow('not yet implemented')
  })
})
