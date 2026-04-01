import { AgentRunner } from '../runners/AgentRunner'
import { Lock } from '../services/LockManager'
import { LockManager } from '../services/LockManager'
import { WorktreeManager } from '../services/WorktreeManager'
import { SocketServer } from '../ws/socket'

export interface ActiveRunner {
  runner: AgentRunner
  lock: Lock
}

/**
 * Shared runtime context injected into all API routers.
 * Using a plain object (not a class) keeps dependency injection simple.
 */
export interface ApiContext {
  lockManager: LockManager
  worktreeManager: WorktreeManager
  socketServer: SocketServer
  /** agentId → active runner + lock handle */
  activeRunners: Map<string, ActiveRunner>
}
