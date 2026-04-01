<template>
  <div class="cost-meter" :class="`cost-meter--${costLevel}`" @click="expanded = !expanded">
    <!-- Main display -->
    <span class="cost-meter__icon">{{ levelIcon }}</span>
    <span class="cost-meter__value">${{ totalCost }}</span>
    <span class="cost-meter__label">/ ${{ stopThreshold.toFixed(0) }}</span>

    <!-- Progress bar -->
    <div class="cost-meter__bar-track">
      <div
        class="cost-meter__bar-fill"
        :style="{ width: barWidth }"
      />
    </div>

    <!-- Dropdown breakdown -->
    <transition name="fade">
      <div v-if="expanded" class="cost-meter__dropdown" @click.stop>
        <div class="cost-meter__dropdown-title">Cost Breakdown</div>
        <div
          v-for="agent in byAgent"
          :key="agent.agentId"
          class="cost-meter__agent-row"
        >
          <span class="cost-meter__agent-id">{{ agent.agentId }}</span>
          <span class="cost-meter__agent-cost">${{ agent.costUsd.toFixed(4) }}</span>
          <span class="cost-meter__agent-tokens">{{ agent.tokensUsed.toLocaleString() }} tok</span>
        </div>
        <div v-if="byAgent.length === 0" class="cost-meter__agent-row cost-meter__no-data">
          No cost data yet
        </div>
        <div class="cost-meter__thresholds">
          <span>Warn: ${{ alertThreshold }}</span>
          <span>Stop: ${{ stopThreshold }}</span>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMetricsStore } from '../stores/metrics'

const metricsStore = useMetricsStore()
const expanded = ref(false)

const costLevel  = computed(() => metricsStore.costLevel)
const totalCost  = computed(() => metricsStore.costData.totalCostUsd.toFixed(4))
const byAgent    = computed(() => metricsStore.costData.byAgent)
const alertThreshold = computed(() => metricsStore.costData.alertThreshold)
const stopThreshold  = computed(() => metricsStore.costData.stopThreshold)

const levelIcon = computed(() => {
  if (costLevel.value === 'stop') return '🛑'
  if (costLevel.value === 'warn') return '⚠️'
  return '💰'
})

const barWidth = computed(() => {
  const pct = (metricsStore.costData.totalCostUsd / stopThreshold.value) * 100
  return `${Math.min(100, pct).toFixed(1)}%`
})
</script>

<style scoped>
.cost-meter {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #3c3c3c;
  background: #252525;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  position: relative;
  transition: border-color 0.2s;
  white-space: nowrap;
}

.cost-meter:hover {
  border-color: #555;
}

.cost-meter--ok   { border-color: #1a4a1a; }
.cost-meter--warn { border-color: #5a4a00; background: #2a2200; }
.cost-meter--stop { border-color: #5a1a1a; background: #2a0a0a; }

.cost-meter__icon {
  font-size: 11px;
  line-height: 1;
}

.cost-meter__value {
  font-weight: 700;
  font-family: monospace;
  letter-spacing: 0.5px;
}

.cost-meter--ok   .cost-meter__value { color: #4ec94e; }
.cost-meter--warn .cost-meter__value { color: #dcdcaa; }
.cost-meter--stop .cost-meter__value { color: #f44; }

.cost-meter__label {
  color: #555;
  font-size: 11px;
}

.cost-meter__bar-track {
  width: 48px;
  height: 4px;
  background: #333;
  border-radius: 2px;
  overflow: hidden;
}

.cost-meter__bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}

.cost-meter--ok   .cost-meter__bar-fill { background: #4ec94e; }
.cost-meter--warn .cost-meter__bar-fill { background: #dcdcaa; }
.cost-meter--stop .cost-meter__bar-fill { background: #f44; }

/* ── Dropdown ─────────────────────────────────── */

.cost-meter__dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  padding: 12px;
  min-width: 220px;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}

.cost-meter__dropdown-title {
  font-size: 11px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.cost-meter__agent-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  border-bottom: 1px solid #333;
}

.cost-meter__agent-row:last-child {
  border-bottom: none;
}

.cost-meter__agent-id {
  flex: 1;
  font-family: monospace;
  color: #9cdcfe;
  font-size: 11px;
}

.cost-meter__agent-cost {
  font-family: monospace;
  color: #4ec94e;
  font-weight: 600;
}

.cost-meter__agent-tokens {
  font-size: 11px;
  color: #555;
}

.cost-meter__no-data {
  color: #555;
  font-style: italic;
  justify-content: center;
}

.cost-meter__thresholds {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #333;
  font-size: 11px;
  color: #666;
}

/* ── Transition ──────────────────────────────── */

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
