// ──────────────────────────────────────────────
// AgentRunner — shared abstract base class
// All concrete runner implementations MUST extend this.
// ──────────────────────────────────────────────

export type AgentType = 'claude-code' | 'gemini-cli' | 'codex'

export interface AgentRunnerConfig {
  agentId: string
  type: AgentType
  worktree: string
  taskDescription: string
}

export abstract class AgentRunner {
  /** Spawn the agent process and begin execution. */
  abstract start(config: AgentRunnerConfig): Promise<void>

  /** Gracefully stop the agent (SIGTERM → SIGKILL after timeout). */
  abstract stop(): Promise<void>

  /** Write a message to the agent's stdin (e.g. follow-up instructions). */
  abstract send(message: string): Promise<void>

  /** Register a callback for each line of terminal output. */
  abstract onLog(callback: (line: string) => void): void

  /** Register a callback invoked when the agent process exits. */
  abstract onFinish(callback: (exitCode: number) => void): void

  /** Return the cumulative token count parsed from agent output. */
  abstract getTokensUsed(): number
}
