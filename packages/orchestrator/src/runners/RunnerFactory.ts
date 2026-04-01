import { AgentRunner } from './AgentRunner'
import { PTYRunner } from './PTYRunner'

export type RunnerType = 'pty' | 'sdk'

export interface RunnerFactoryConfig {
  runner: RunnerType
}

export class RunnerFactory {
  static create(config: RunnerFactoryConfig): AgentRunner {
    switch (config.runner) {
      case 'pty':
        return new PTYRunner()
      case 'sdk':
        // SDKRunner is implemented in Step 9
        throw new Error('SDKRunner is not yet implemented')
      default: {
        const exhaustive: never = config.runner
        throw new Error(`Unknown runner type: ${String(exhaustive)}`)
      }
    }
  }
}
