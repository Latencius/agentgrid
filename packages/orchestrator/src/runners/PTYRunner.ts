import * as pty from 'node-pty'
import { AgentRunner, AgentRunnerConfig, AgentType } from './AgentRunner'
import { logger } from '../utils/logger'

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STOP_TIMEOUT_MS = 5_000

/** Map agent type → shell command to invoke. */
const IS_WINDOWS = process.platform === 'win32'
const AGENT_COMMANDS: Record<AgentType, string> = {
  'claude-code': IS_WINDOWS ? 'claude.cmd' : 'claude',
  'gemini-cli':  IS_WINDOWS ? 'gemini.cmd'  : 'gemini',
  'codex':       IS_WINDOWS ? 'codex.cmd'   : 'codex',
}

/**
 * Regex patterns to extract token counts from Claude Code output.
 * Claude Code prints lines such as:
 *   "Tokens: 1,234 input · 567 output"
 * or the compact version: "(1234 tokens)"
 */
const TOKEN_PATTERNS: RegExp[] = [
  /Tokens:\s*([\d,]+)\s*input\s*[·•]\s*([\d,]+)\s*output/i,
  /\((\d+)\s+tokens?\)/i,
]

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Strip ANSI escape sequences from a string. */
function stripAnsi(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/\x1b\[[0-9;]*[mGKHF]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
}

/** Parse token count from a single output line; returns tokens found or 0. */
function parseTokens(line: string): number {
  for (const pattern of TOKEN_PATTERNS) {
    const match = pattern.exec(line)
    if (match) {
      if (match[2] !== undefined) {
        // "N input · M output" pattern → sum both
        const input = parseInt(match[1]!.replace(/,/g, ''), 10)
        const output = parseInt(match[2].replace(/,/g, ''), 10)
        return input + output
      }
      return parseInt(match[1]!.replace(/,/g, ''), 10)
    }
  }
  return 0
}

// ──────────────────────────────────────────────
// PTYRunner
// ──────────────────────────────────────────────

export class PTYRunner extends AgentRunner {
  private process: pty.IPty | null = null
  private logCallbacks: Array<(line: string) => void> = []
  private finishCallbacks: Array<(exitCode: number) => void> = []
  private tokensUsed = 0
  private lineBuffer = ''
  private config: AgentRunnerConfig | null = null
  private stopped = false

  // ── Public interface ──────────────────────────

  async start(config: AgentRunnerConfig): Promise<void> {
    if (this.process !== null) {
      throw new Error(`PTYRunner[${config.agentId}]: already running`)
    }

    this.config = config
    this.stopped = false

    const command = AGENT_COMMANDS[config.type]
    logger.info(`PTYRunner starting`, { agentId: config.agentId, command, cwd: config.worktree })

    this.process = pty.spawn(command, [], {
      name: 'xterm-color',
      cols: 220,
      rows: 50,
      cwd: config.worktree,
      env: process.env as Record<string, string>,
    })

    this.process.onData((data) => this.handleData(data))

    this.process.onExit(({ exitCode }) => {
      this.flushLineBuffer()
      const code = exitCode ?? 1
      logger.info(`PTYRunner exited`, { agentId: config.agentId, exitCode: code })
      this.process = null
      for (const cb of this.finishCallbacks) cb(code)
    })
  }

  async stop(): Promise<void> {
    if (this.process === null || this.stopped) return
    this.stopped = true

    const agentId = this.config?.agentId ?? 'unknown'
    logger.info(`PTYRunner stopping`, { agentId })

    // Send Ctrl+C first for graceful shutdown
    try {
      this.process.write('\x03')
    } catch {
      // process may have already exited
    }

    const killTimer = setTimeout(() => {
      if (this.process !== null) {
        logger.warn(`PTYRunner force-killing after timeout`, { agentId })
        try {
          this.process.kill()
        } catch {
          // already gone
        }
      }
    }, STOP_TIMEOUT_MS)

    // Wait for the exit event (fired by onExit handler above)
    await new Promise<void>((resolve) => {
      if (this.process === null) {
        clearTimeout(killTimer)
        resolve()
        return
      }
      this.process.onExit(() => {
        clearTimeout(killTimer)
        resolve()
      })
    })
  }

  async send(message: string): Promise<void> {
    if (this.process === null) {
      throw new Error(`PTYRunner[${this.config?.agentId}]: not running — cannot send message`)
    }
    // Append newline so the agent treats it as an Enter keypress
    this.process.write(message.endsWith('\n') ? message : message + '\n')
  }

  onLog(callback: (line: string) => void): void {
    this.logCallbacks.push(callback)
  }

  onFinish(callback: (exitCode: number) => void): void {
    this.finishCallbacks.push(callback)
  }

  getTokensUsed(): number {
    return this.tokensUsed
  }

  // ── Private helpers ───────────────────────────

  private handleData(data: string): void {
    this.lineBuffer += data

    const lines = this.lineBuffer.split('\n')
    // Keep the last (potentially incomplete) segment in the buffer
    this.lineBuffer = lines.pop() ?? ''

    for (const raw of lines) {
      this.emitLine(raw)
    }
  }

  private flushLineBuffer(): void {
    if (this.lineBuffer.length > 0) {
      this.emitLine(this.lineBuffer)
      this.lineBuffer = ''
    }
  }

  private emitLine(raw: string): void {
    const line = stripAnsi(raw).replace(/\r$/, '')
    if (line.length === 0) return

    const parsed = parseTokens(line)
    if (parsed > 0) this.tokensUsed += parsed

    for (const cb of this.logCallbacks) cb(line)
  }
}
