<template>
  <div class="agent-grid">
    <!-- Header bar -->
    <div class="agent-grid__header">
      <h2 class="agent-grid__title">Agents</h2>
      <div class="agent-grid__meta">
        <span class="agent-grid__count">{{ agents.length }} agent(s)</span>
        <span
          class="agent-grid__ws-status"
          :class="isConnected ? 'agent-grid__ws-status--ok' : 'agent-grid__ws-status--err'"
        >
          {{ isConnected ? 'WS Connected' : 'WS Disconnected' }}
        </span>
      </div>
    </div>

    <!-- Error banner -->
    <div v-if="agentsStore.error" class="agent-grid__error">
      {{ agentsStore.error }}
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="agent-grid__loading">Loading agents...</div>

    <!-- Empty state -->
    <div v-else-if="agents.length === 0" class="agent-grid__empty">
      No agents registered. Add agents via the CLI or REST API.
    </div>

    <!-- Grid -->
    <div v-else class="agent-grid__cards">
      <AgentCard
        v-for="agent in agents"
        :key="agent.id"
        :agent="agent"
        :selected="selectedAgentId === agent.id"
        @select="onSelect"
        @start="agentsStore.startAgent"
        @stop="agentsStore.stopAgent"
      />
    </div>

    <!-- Terminal panel for selected agent -->
    <div v-if="selectedAgentId" class="agent-grid__terminal">
      <div class="agent-grid__terminal-header">
        <span>{{ selectedAgentId }}</span>
        <button class="agent-grid__close" @click="selectedAgentId = null">×</button>
      </div>
      <TerminalView :lines="selectedLogs" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAgentsStore } from '../stores/agents'
import { useWebSocket } from '../composables/useWebSocket'
import AgentCard from './AgentCard.vue'
import TerminalView from './TerminalView.vue'

// ── State ──────────────────────────────────────

const agentsStore = useAgentsStore()
const { isConnected } = useWebSocket()

const loading = ref(false)
const selectedAgentId = ref<string | null>(null)

// ── Computed ───────────────────────────────────

const agents = computed(() => agentsStore.agents)

const selectedLogs = computed(() =>
  selectedAgentId.value ? (agentsStore.logs[selectedAgentId.value] ?? []) : [],
)

// ── Handlers ───────────────────────────────────

function onSelect(agentId: string): void {
  selectedAgentId.value = selectedAgentId.value === agentId ? null : agentId
}

// ── Lifecycle ──────────────────────────────────

onMounted(async () => {
  loading.value = true
  await agentsStore.fetchAgents()
  loading.value = false
})
</script>

<style scoped>
.agent-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  color: #d4d4d4;
}

.agent-grid__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agent-grid__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #e8e8e8;
}

.agent-grid__meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}

.agent-grid__count {
  color: #888;
}

.agent-grid__ws-status {
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.agent-grid__ws-status--ok  { background: #1a4a1a; color: #4ec94e; }
.agent-grid__ws-status--err { background: #4a1a1a; color: #f44; }

.agent-grid__error {
  background: #4a1a1a;
  color: #f88;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}

.agent-grid__loading,
.agent-grid__empty {
  color: #666;
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}

.agent-grid__cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}

.agent-grid__terminal {
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  overflow: hidden;
}

.agent-grid__terminal-header {
  background: #2d2d2d;
  padding: 6px 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-family: monospace;
  color: #9cdcfe;
}

.agent-grid__close {
  background: none;
  border: none;
  color: #888;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}

.agent-grid__close:hover {
  color: #ddd;
}
</style>
