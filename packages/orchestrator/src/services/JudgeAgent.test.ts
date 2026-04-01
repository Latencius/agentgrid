import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JudgeAgent, type JudgeConfig } from './JudgeAgent'
import type { SocketServer } from '../ws/socket'
import type { Score } from '../store/db'

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

vi.mock('../store/db', () => ({
  createScore: vi.fn(),
}))

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

import { execFile } from 'child_process'
import { createScore } from '../store/db'
import { promisify } from 'util'

// promisify wraps execFile, so we mock execFile's callback form
const mockedExecFile = vi.mocked(execFile)
const mockedCreateScore = vi.mocked(createScore)

// ──────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────

const baseConfig: JudgeConfig = {
  enabled: true,
  type: 'claude-code',
  runner: 'sdk',
  scoreItems: ['completion', 'quality', 'security', 'ux', 'tests'],
}

const mockScore: Score = {
  id: 'score-1',
  task_id: 'task-1',
  agent_id: 'agent-1',
  completion: 90,
  quality: 80,
  security: 95,
  ux: 75,
  tests: 70,
  comment: 'Good implementation',
  judged_at: '2026-04-01T00:00:00Z',
}

const sampleModelOutput = JSON.stringify({
  completion: 90,
  quality: 80,
  security: 95,
  ux: 75,
  tests: 70,
  comment: 'Good implementation',
})

function makeSocketServer(): SocketServer {
  return {
    emitScoreUpdated: vi.fn(),
    emitAgentStatus: vi.fn(),
    emitAgentLog: vi.fn(),
    emitTaskStatus: vi.fn(),
    emitCostUpdated: vi.fn(),
    onAgentSend: vi.fn(),
    close: vi.fn(),
    connectedClients: 0,
  } as unknown as SocketServer
}

/** Helper: make execFile invoke its callback with (null, stdout, '') */
function mockExecFileOutput(stdout: string): void {
  mockedExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      (callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, { stdout, stderr: '' })
      return {} as ReturnType<typeof execFile>
    },
  )
}

function mockExecFileSequence(outputs: string[]): void {
  let call = 0
  mockedExecFile.mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
      const out = outputs[call++] ?? ''
      ;(callback as (err: null, result: { stdout: string; stderr: string }) => void)(null, { stdout: out, stderr: '' })
      return {} as ReturnType<typeof execFile>
    },
  )
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('JudgeAgent', () => {
  let socketServer: SocketServer

  beforeEach(() => {
    vi.clearAllMocks()
    socketServer = makeSocketServer()
  })

  // ── buildPrompt ───────────────────────────────

  describe('buildPrompt', () => {
    it('includes taskDescription and diff in output', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const prompt = agent.buildPrompt('Add login feature', 'diff --git a/login.ts')
      expect(prompt).toContain('Add login feature')
      expect(prompt).toContain('diff --git a/login.ts')
    })

    it('truncates diff longer than 8000 bytes', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const longDiff = 'x'.repeat(9000)
      const prompt = agent.buildPrompt('task', longDiff)
      expect(prompt).toContain('...(truncated)')
      expect(prompt.length).toBeLessThan(9500)
    })

    it('does not truncate diff within limit', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const diff = 'x'.repeat(7000)
      const prompt = agent.buildPrompt('task', diff)
      expect(prompt).not.toContain('...(truncated)')
    })
  })

  // ── parseResult ───────────────────────────────

  describe('parseResult', () => {
    it('parses valid JSON from clean output', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const result = agent.parseResult(sampleModelOutput)
      expect(result.completion).toBe(90)
      expect(result.quality).toBe(80)
      expect(result.comment).toBe('Good implementation')
    })

    it('extracts JSON from noisy surrounding text', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const noisy = `Here is my evaluation:\n\n${sampleModelOutput}\n\nI hope that helps!`
      const result = agent.parseResult(noisy)
      expect(result.completion).toBe(90)
    })

    it('clamps scores above 100', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const raw = JSON.stringify({ completion: 120, quality: 80, security: 95, ux: 75, tests: 70, comment: 'ok' })
      const result = agent.parseResult(raw)
      expect(result.completion).toBe(100)
    })

    it('clamps scores below 0', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const raw = JSON.stringify({ completion: -5, quality: 80, security: 95, ux: 75, tests: 70, comment: 'ok' })
      const result = agent.parseResult(raw)
      expect(result.completion).toBe(0)
    })

    it('throws when no JSON found', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      expect(() => agent.parseResult('no json here')).toThrow('No JSON object found')
    })

    it('throws when JSON missing required fields', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      expect(() => agent.parseResult('{"completion": 90}')).toThrow('Unexpected judge result shape')
    })

    it('truncates comment to 200 characters', () => {
      const agent = new JudgeAgent(baseConfig, socketServer)
      const longComment = 'a'.repeat(300)
      const raw = JSON.stringify({ completion: 90, quality: 80, security: 95, ux: 75, tests: 70, comment: longComment })
      const result = agent.parseResult(raw)
      expect(result.comment.length).toBe(200)
    })
  })

  // ── judge ─────────────────────────────────────

  describe('judge', () => {
    const params = {
      taskId: 'task-1',
      taskDescription: 'Implement login',
      agentId: 'agent-1',
      worktree: '/repo/worktrees/agent-1',
    }

    it('returns null when disabled', async () => {
      const agent = new JudgeAgent({ ...baseConfig, enabled: false }, socketServer)
      const result = await agent.judge(params)
      expect(result).toBeNull()
      expect(mockedCreateScore).not.toHaveBeenCalled()
    })

    it('persists score and emits WS event on success', async () => {
      mockedCreateScore.mockReturnValue(mockScore)
      // First call: git diff HEAD → returns diff; second call: model → returns JSON
      mockExecFileSequence(['diff --git a/login.ts\n+code', sampleModelOutput])

      const agent = new JudgeAgent(baseConfig, socketServer)
      const score = await agent.judge(params)

      expect(score).toEqual(mockScore)
      expect(mockedCreateScore).toHaveBeenCalledOnce()
      expect(socketServer.emitScoreUpdated).toHaveBeenCalledOnce()
    })

    it('falls back to HEAD~1 diff when working tree is clean', async () => {
      mockedCreateScore.mockReturnValue(mockScore)
      // First execFile (git diff HEAD) → empty; second (git diff HEAD~1 HEAD) → diff; third → model
      mockExecFileSequence(['', 'diff --git a/foo.ts\n+bar', sampleModelOutput])

      const agent = new JudgeAgent(baseConfig, socketServer)
      const score = await agent.judge(params)

      expect(score).toEqual(mockScore)
    })

    it('returns null when no diff found', async () => {
      mockExecFileSequence(['', ''])
      const agent = new JudgeAgent(baseConfig, socketServer)
      const result = await agent.judge(params)
      expect(result).toBeNull()
      expect(mockedCreateScore).not.toHaveBeenCalled()
    })

    it('returns null and logs error on model failure', async () => {
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
          let callCount = 0
          callCount++
          if (callCount <= 2) {
            // git diff calls succeed
            ;(callback as (err: null, result: { stdout: string; stderr: string }) => void)(
              null, { stdout: callCount === 1 ? 'diff content' : '', stderr: '' }
            )
          } else {
            ;(callback as (err: Error) => void)(new Error('command not found: claude'))
          }
          return {} as ReturnType<typeof execFile>
        },
      )
      // Simpler: just return diff on first call, error on second
      let callCount = 0
      mockedExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, callback: unknown) => {
          callCount++
          if (callCount === 1) {
            ;(callback as (err: null, result: { stdout: string; stderr: string }) => void)(
              null, { stdout: 'some diff', stderr: '' }
            )
          } else {
            ;(callback as (err: Error) => void)(new Error('command not found: claude'))
          }
          return {} as ReturnType<typeof execFile>
        },
      )

      const agent = new JudgeAgent(baseConfig, socketServer)
      const result = await agent.judge(params)
      expect(result).toBeNull()
      expect(mockedCreateScore).not.toHaveBeenCalled()
    })
  })
})
