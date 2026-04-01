<template>
  <div class="app">
    <header class="app__header">
      <h1 class="app__logo">AgentGrid</h1>
      <nav class="app__nav">
        <button
          v-for="tab in TABS"
          :key="tab.id"
          class="app__tab"
          :class="{ 'app__tab--active': activeTab === tab.id }"
          @click="activeTab = tab.id"
        >
          {{ tab.label }}
        </button>
      </nav>
      <div class="app__header-right">
        <CostMeter />
      </div>
    </header>

    <!-- Cost alert banners -->
    <div v-if="costLevel === 'stop'" class="app__alert app__alert--stop" role="alert">
      🛑 コスト上限に達しました (${{ totalCost }} / ${{ stopThreshold }}) —
      実行中のエージェントを停止してください。
    </div>
    <div v-else-if="costLevel === 'warn'" class="app__alert app__alert--warn" role="alert">
      ⚠️ コスト警告: ${{ totalCost }} / ${{ alertThreshold }} —
      上限 ${{ stopThreshold }} に近づいています。
    </div>

    <main class="app__main">
      <AgentGrid   v-if="activeTab === 'agents'" />
      <TaskBoard   v-if="activeTab === 'tasks'"  />
      <ScoresPane  v-if="activeTab === 'scores'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import AgentGrid  from './components/AgentGrid.vue'
import TaskBoard  from './components/TaskBoard.vue'
import ScoresPane from './components/ScoresPane.vue'
import CostMeter  from './components/CostMeter.vue'
import { useMetricsStore } from './stores/metrics'

const TABS = [
  { id: 'agents', label: 'Agents' },
  { id: 'tasks',  label: 'Tasks'  },
  { id: 'scores', label: 'Scores' },
] as const

type TabId = typeof TABS[number]['id']
const activeTab = ref<TabId>('agents')

// Cost alert state
const metricsStore = useMetricsStore()
const costLevel     = computed(() => metricsStore.costLevel)
const totalCost     = computed(() => metricsStore.costData.totalCostUsd.toFixed(4))
const alertThreshold = computed(() => metricsStore.costData.alertThreshold)
const stopThreshold  = computed(() => metricsStore.costData.stopThreshold)

onMounted(async () => {
  await metricsStore.fetchCost()
  // Re-fetch every 60s to stay in sync even without WS events
  setInterval(() => { void metricsStore.fetchCost() }, 60_000)
})
</script>

<style>
*, *::before, *::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
</style>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app__header {
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 24px;
  height: 48px;
}

.app__logo {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #0e7fd0;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.app__nav {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 100%;
  flex: 1;
}

.app__header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.app__tab {
  padding: 0 16px;
  height: 100%;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #888;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.app__tab:hover {
  color: #d4d4d4;
}

.app__tab--active {
  color: #e8e8e8;
  border-bottom-color: #0e7fd0;
}

/* ── Alert banners ───────────────────────────── */

.app__alert {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
}

.app__alert--warn {
  background: #2a2000;
  color: #dcdcaa;
  border-bottom: 1px solid #5a4a00;
}

.app__alert--stop {
  background: #2a0a0a;
  color: #f88;
  border-bottom: 1px solid #7a1a1a;
  animation: pulse-stop 2s ease-in-out infinite;
}

@keyframes pulse-stop {
  0%, 100% { background: #2a0a0a; }
  50%       { background: #3a1010; }
}

.app__main {
  flex: 1;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}
</style>
