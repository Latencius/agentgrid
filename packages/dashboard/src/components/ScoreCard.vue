<template>
  <div class="score-card">
    <!-- Header -->
    <div class="score-card__header">
      <span v-if="taskTitle" class="score-card__title">{{ taskTitle }}</span>
      <code class="score-card__task-id">{{ taskId.slice(0, 8) }}</code>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="score-card__loading">Loading scores…</div>

    <!-- Error -->
    <div v-else-if="metricsStore.error" class="score-card__error" role="alert">
      {{ metricsStore.error }}
    </div>

    <!-- Empty -->
    <div v-else-if="scores.length === 0" class="score-card__empty">
      No scores yet
    </div>

    <!-- Scores -->
    <template v-else>
      <!-- Average hero -->
      <div class="score-card__avg" aria-label="Average score">
        <span class="score-card__avg-value">{{ avg ?? '—' }}</span>
        <span class="score-card__avg-label">/ 100</span>
      </div>

      <!-- Per-agent entries -->
      <div
        v-for="score in scores"
        :key="score.id"
        class="score-card__entry"
      >
        <div class="score-card__agent-badge">{{ score.agent_id }}</div>

        <!-- Dimension bars -->
        <div class="score-card__dims">
          <div
            v-for="dim in DIMS"
            :key="dim.key"
            class="score-card__dim"
            :data-dim="dim.key"
          >
            <span class="score-card__dim-label">{{ dim.label }}</span>
            <div class="score-card__bar-track">
              <div
                class="score-card__bar-fill"
                :class="barClass(score[dim.key])"
                :style="{ width: barWidth(score[dim.key]) }"
              />
            </div>
            <span class="score-card__dim-value">{{ score[dim.key] ?? '—' }}</span>
          </div>
        </div>

        <!-- Comment -->
        <p v-if="score.comment" class="score-card__comment">
          {{ score.comment }}
        </p>

        <!-- Judged at -->
        <time class="score-card__judged-at" :datetime="score.judged_at">
          {{ formatDate(score.judged_at) }}
        </time>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useMetricsStore, type Score } from '../stores/metrics'

// ── Props ─────────────────────────────────────

interface Props {
  taskId: string
  taskTitle?: string
}

const props = defineProps<Props>()

// ── Store ─────────────────────────────────────

const metricsStore = useMetricsStore()

// ── Local state ───────────────────────────────

const loading = ref(false)

// ── Derived ───────────────────────────────────

const scores = computed<Score[]>(() => metricsStore.scoresByTask[props.taskId] ?? [])
const avg = computed<number | null>(() => metricsStore.avgForTask(props.taskId))

// ── Constants ─────────────────────────────────

interface Dim {
  key: keyof Pick<Score, 'completion' | 'quality' | 'security' | 'ux' | 'tests'>
  label: string
}

const DIMS: Dim[] = [
  { key: 'completion', label: 'Completion' },
  { key: 'quality',    label: 'Quality'    },
  { key: 'security',   label: 'Security'   },
  { key: 'ux',         label: 'UX'         },
  { key: 'tests',      label: 'Tests'      },
]

// ── Helpers ───────────────────────────────────

function barWidth(value: number | null): string {
  if (value === null || value === undefined) return '0%'
  return `${Math.max(0, Math.min(100, value))}%`
}

function barClass(value: number | null): string {
  if (value === null || value === undefined) return 'score-card__bar-fill--none'
  if (value >= 80) return 'score-card__bar-fill--high'
  if (value >= 50) return 'score-card__bar-fill--mid'
  return 'score-card__bar-fill--low'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Lifecycle ─────────────────────────────────

onMounted(async () => {
  loading.value = true
  await metricsStore.fetchScores(props.taskId)
  loading.value = false
})
</script>

<style scoped>
.score-card {
  background: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: #d4d4d4;
}

.score-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.score-card__title {
  font-size: 14px;
  font-weight: 600;
  color: #e8e8e8;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.score-card__task-id {
  font-family: monospace;
  font-size: 11px;
  color: #555;
}

/* ── States ──────────────────────────────────── */

.score-card__loading,
.score-card__empty {
  color: #555;
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}

.score-card__error {
  background: #4a1a1a;
  color: #f88;
  padding: 6px 10px;
  border-radius: 5px;
  font-size: 12px;
}

/* ── Average hero ────────────────────────────── */

.score-card__avg {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.score-card__avg-value {
  font-size: 36px;
  font-weight: 700;
  color: #4ec94e;
  line-height: 1;
}

.score-card__avg-label {
  font-size: 14px;
  color: #666;
}

/* ── Entry ───────────────────────────────────── */

.score-card__entry {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid #333;
  padding-top: 10px;
}

.score-card__agent-badge {
  font-size: 11px;
  font-family: monospace;
  color: #9cdcfe;
  background: #1a3a5c;
  border-radius: 3px;
  padding: 2px 7px;
  align-self: flex-start;
}

/* ── Dimension bars ──────────────────────────── */

.score-card__dims {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.score-card__dim {
  display: grid;
  grid-template-columns: 80px 1fr 32px;
  align-items: center;
  gap: 8px;
}

.score-card__dim-label {
  font-size: 11px;
  color: #888;
  text-align: right;
}

.score-card__bar-track {
  background: #333;
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}

.score-card__bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.score-card__bar-fill--high { background: #4ec94e; }
.score-card__bar-fill--mid  { background: #dcdcaa; }
.score-card__bar-fill--low  { background: #f44; }
.score-card__bar-fill--none { background: transparent; }

.score-card__dim-value {
  font-size: 11px;
  color: #888;
  text-align: right;
  font-family: monospace;
}

/* ── Comment & timestamp ─────────────────────── */

.score-card__comment {
  margin: 0;
  font-size: 12px;
  color: #aaa;
  line-height: 1.5;
  font-style: italic;
  border-left: 2px solid #3c3c3c;
  padding-left: 8px;
}

.score-card__judged-at {
  font-size: 11px;
  color: #555;
  align-self: flex-end;
}
</style>
