import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import ScoreCard from './ScoreCard.vue'
import { useMetricsStore, type Score } from '../stores/metrics'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeScore(overrides: Partial<Score> = {}): Score {
  return {
    id: 's-1',
    task_id: 'task-1',
    agent_id: 'worker-1',
    completion: 80,
    quality: 70,
    security: 90,
    ux: 60,
    tests: 75,
    comment: null,
    judged_at: '2026-04-01T00:00:00Z',
    ...overrides,
  }
}

function mountCard(
  pinia: Pinia,
  props: { taskId: string; taskTitle?: string } = { taskId: 'task-1' },
) {
  const wrapper = mount(ScoreCard, {
    global: { plugins: [pinia] },
    props,
  })
  const metricsStore = useMetricsStore()
  return { wrapper, metricsStore }
}

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────

let pinia: Pinia

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.unstubAllGlobals()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
})

// ──────────────────────────────────────────────
// Loading state
// ──────────────────────────────────────────────

describe('loading state', () => {
  it('shows loading indicator while fetch is in-flight', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const { wrapper } = mountCard(pinia)
    await nextTick() // let loading.value = true flush to DOM
    expect(wrapper.text()).toContain('Loading scores')
  })

  it('hides loading indicator after fetch completes', async () => {
    const { wrapper } = mountCard(pinia)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Loading scores')
  })
})

// ──────────────────────────────────────────────
// Empty state
// ──────────────────────────────────────────────

describe('empty state', () => {
  it('shows "No scores yet" when scores array is empty', async () => {
    const { wrapper } = mountCard(pinia)
    await flushPromises()
    expect(wrapper.text()).toContain('No scores yet')
  })
})

// ──────────────────────────────────────────────
// Score bars rendering
// ──────────────────────────────────────────────

describe('score bars rendering', () => {
  it('renders all five dimension bars', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore()])
    await nextTick()

    for (const dim of ['completion', 'quality', 'security', 'ux', 'tests']) {
      expect(wrapper.find(`[data-dim="${dim}"]`).exists()).toBe(true)
    }
  })

  it('sets bar width based on score value', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ completion: 60 })])
    await nextTick()

    const bar = wrapper.find('[data-dim="completion"] .score-card__bar-fill')
    expect(bar.attributes('style')).toContain('width: 60%')
  })

  it('shows "—" for null dimension values', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ quality: null })])
    await nextTick()

    expect(wrapper.find('[data-dim="quality"]').text()).toContain('—')
  })

  it('displays the average score prominently', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [
      makeScore({ completion: 80, quality: 80, security: 80, ux: 80, tests: 80 }),
    ])
    await nextTick()

    expect(wrapper.find('.score-card__avg-value').text()).toBe('80')
  })

  it('applies high class to bars with score >= 80', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ completion: 85 })])
    await nextTick()

    const bar = wrapper.find('[data-dim="completion"] .score-card__bar-fill')
    expect(bar.classes()).toContain('score-card__bar-fill--high')
  })

  it('applies low class to bars with score < 50', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ ux: 30 })])
    await nextTick()

    const bar = wrapper.find('[data-dim="ux"] .score-card__bar-fill')
    expect(bar.classes()).toContain('score-card__bar-fill--low')
  })
})

// ──────────────────────────────────────────────
// Comment display
// ──────────────────────────────────────────────

describe('comment display', () => {
  it('shows comment text when present', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ comment: 'Great error handling!' })])
    await nextTick()

    expect(wrapper.text()).toContain('Great error handling!')
  })

  it('does not render comment element when comment is null', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ comment: null })])
    await nextTick()

    expect(wrapper.find('.score-card__comment').exists()).toBe(false)
  })
})

// ──────────────────────────────────────────────
// fetchScores called on mount
// ──────────────────────────────────────────────

describe('fetchScores on mount', () => {
  it('calls the correct API endpoint on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    mountCard(pinia, { taskId: 'explicit-task' })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/scores/explicit-task')
  })
})

// ──────────────────────────────────────────────
// Reactivity: setScores updates component
// ──────────────────────────────────────────────

describe('setScores reactivity', () => {
  it('renders new scores when store is updated after mount', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    expect(wrapper.text()).toContain('No scores yet')

    metricsStore.setScores('task-1', [makeScore({ agent_id: 'agent-x' })])
    await nextTick()
    expect(wrapper.text()).toContain('agent-x')
  })

  it('updates average when scores change reactively', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [
      makeScore({ completion: 100, quality: 100, security: 100, ux: 100, tests: 100 }),
    ])
    await nextTick()
    expect(wrapper.find('.score-card__avg-value').text()).toBe('100')
  })
})

// ──────────────────────────────────────────────
// Agent badge
// ──────────────────────────────────────────────

describe('agent badge', () => {
  it('renders the agent_id in the badge', async () => {
    const { wrapper, metricsStore } = mountCard(pinia)
    await flushPromises()
    metricsStore.setScores('task-1', [makeScore({ agent_id: 'claude-worker-3' })])
    await nextTick()

    expect(wrapper.find('.score-card__agent-badge').text()).toBe('claude-worker-3')
  })
})

// ──────────────────────────────────────────────
// taskTitle prop
// ──────────────────────────────────────────────

describe('taskTitle prop', () => {
  it('shows taskTitle when provided', async () => {
    const { wrapper } = mountCard(pinia, { taskId: 'task-1', taskTitle: 'Build API' })
    await flushPromises()
    expect(wrapper.text()).toContain('Build API')
  })

  it('omits title element when taskTitle is not provided', async () => {
    const { wrapper } = mountCard(pinia, { taskId: 'task-1' })
    await flushPromises()
    expect(wrapper.find('.score-card__title').exists()).toBe(false)
  })
})
