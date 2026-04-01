<template>
  <div
    class="agent-card"
    :class="[`agent-card--${agent.status}`, { 'agent-card--selected': selected }]"
    @click="emit('select', agent.id)"
  >
    <div class="agent-card__header">
      <span class="agent-card__id" :title="agent.id">{{ shortId }}</span>
      <span class="agent-card__badge" :class="`agent-card__badge--${agent.status}`">
        {{ agent.status }}
      </span>
    </div>

    <div class="agent-card__type">
      <span class="agent-card__type-icon">{{ typeIcon }}</span>
      {{ agent.type }}
    </div>

    <div class="agent-card__runner">
      runner: <strong>{{ agent.runner }}</strong>
    </div>

    <div v-if="agent.current_task_id" class="agent-card__task">
      task: <code>{{ agent.current_task_id.slice(0, 8) }}</code>
    </div>
    <div v-else class="agent-card__task agent-card__task--none">No task</div>

    <div class="agent-card__metrics">
      <span>{{ agent.tokens_used.toLocaleString() }} tok</span>
      <span>${{ agent.cost_usd.toFixed(4) }}</span>
    </div>

    <div class="agent-card__actions" @click.stop>
      <button
        v-if="agent.status === 'idle' || agent.status === 'stopped'"
        class="btn btn--start"
        @click="emit('start', agent.id)"
      >Start</button>
      <button
        v-if="agent.status === 'running'"
        class="btn btn--stop"
        @click="emit('stop', agent.id)"
      >Stop</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Agent } from '../stores/agents'

interface Props {
  agent: Agent
  selected: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [agentId: string]
  start: [agentId: string]
  stop: [agentId: string]
}>()

const shortId = computed(() => props.agent.id.slice(0, 10))

const typeIcon = computed(() => {
  const icons: Record<string, string> = {
    'claude-code': '🤖',
    'gemini-cli': '💎',
    'codex': '⚡',
  }
  return icons[props.agent.type] ?? '?'
})
</script>

<style scoped>
.agent-card {
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-card:hover {
  border-color: #555;
}

.agent-card--selected {
  border-color: #0e7fd0;
  box-shadow: 0 0 0 2px rgba(14, 127, 208, 0.3);
}

.agent-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.agent-card__id {
  font-family: monospace;
  font-size: 13px;
  color: #9cdcfe;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-card__badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
}

.agent-card__badge--idle    { background: #3a3a3a; color: #888; }
.agent-card__badge--running { background: #1a4a1a; color: #4ec94e; }
.agent-card__badge--stopped { background: #2a2a2a; color: #666; }
.agent-card__badge--error   { background: #4a1a1a; color: #f44; }

.agent-card__type {
  font-size: 13px;
  color: #ce9178;
}

.agent-card__runner {
  font-size: 12px;
  color: #888;
}

.agent-card__task {
  font-size: 12px;
  color: #dcdcaa;
}

.agent-card__task--none {
  color: #555;
  font-style: italic;
}

.agent-card__metrics {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

.agent-card__actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  padding: 3px 10px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}

.btn--start { background: #1a4a1a; color: #4ec94e; }
.btn--start:hover { background: #1e5a1e; }
.btn--stop  { background: #4a1a1a; color: #f66; }
.btn--stop:hover  { background: #5a1a1a; }
</style>
