import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMetricsStore, type Score } from './metrics'

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

function mockFetch(response: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => response,
  }))
}

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────

beforeEach(() => {
  setActivePinia(createPinia())
  vi.unstubAllGlobals()
})

// ──────────────────────────────────────────────
// fetchScores
// ──────────────────────────────────────────────

describe('fetchScores()', () => {
  it('populates scoresByTask on success', async () => {
    const store = useMetricsStore()
    mockFetch([makeScore()])
    await store.fetchScores('task-1')
    expect(store.scoresByTask['task-1']).toHaveLength(1)
    expect(store.error).toBeNull()
  })

  it('sets error on HTTP failure', async () => {
    const store = useMetricsStore()
    mockFetch({}, false, 500)
    await store.fetchScores('task-1')
    expect(store.error).toMatch(/HTTP 500/)
  })

  it('sets error on network failure', async () => {
    const store = useMetricsStore()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    await store.fetchScores('task-1')
    expect(store.error).toMatch(/Network error/)
  })

  it('calls correct endpoint with taskId', async () => {
    const store = useMetricsStore()
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchSpy)
    await store.fetchScores('my-task-id')
    expect(fetchSpy).toHaveBeenCalledWith('/api/scores/my-task-id')
  })

  it('does not overwrite scores of other tasks', async () => {
    const store = useMetricsStore()
    store.setScores('task-2', [makeScore({ task_id: 'task-2', id: 's-2' })])
    mockFetch([makeScore()])
    await store.fetchScores('task-1')
    expect(store.scoresByTask['task-2']).toHaveLength(1)
  })
})

// ──────────────────────────────────────────────
// setScores (called by WebSocket)
// ──────────────────────────────────────────────

describe('setScores()', () => {
  it('stores scores for the given taskId', () => {
    const store = useMetricsStore()
    store.setScores('task-1', [makeScore()])
    expect(store.scoresByTask['task-1']).toHaveLength(1)
  })

  it('replaces existing scores for the same taskId', () => {
    const store = useMetricsStore()
    store.setScores('task-1', [makeScore({ id: 's-1' })])
    store.setScores('task-1', [makeScore({ id: 's-2' }), makeScore({ id: 's-3' })])
    expect(store.scoresByTask['task-1']).toHaveLength(2)
    expect(store.scoresByTask['task-1']![0]!.id).toBe('s-2')
  })

  it('does not affect other taskIds', () => {
    const store = useMetricsStore()
    store.setScores('task-1', [makeScore()])
    store.setScores('task-2', [makeScore({ id: 's-2', task_id: 'task-2' })])
    expect(store.scoresByTask['task-1']).toHaveLength(1)
    expect(store.scoresByTask['task-2']).toHaveLength(1)
  })
})

// ──────────────────────────────────────────────
// avgForTask
// ──────────────────────────────────────────────

describe('avgForTask()', () => {
  it('returns null when no scores exist for the task', () => {
    const store = useMetricsStore()
    expect(store.avgForTask('task-1')).toBeNull()
  })

  it('returns null for an empty scores array', () => {
    const store = useMetricsStore()
    store.setScores('task-1', [])
    expect(store.avgForTask('task-1')).toBeNull()
  })

  it('calculates average across all five dimensions', () => {
    const store = useMetricsStore()
    store.setScores('task-1', [
      makeScore({ completion: 80, quality: 80, security: 80, ux: 80, tests: 80 }),
    ])
    expect(store.avgForTask('task-1')).toBe(80)
  })

  it('rounds the average to nearest integer', () => {
    const store = useMetricsStore()
    // (70 + 71 + 72 + 73 + 74) / 5 = 72
    store.setScores('task-1', [
      makeScore({ completion: 70, quality: 71, security: 72, ux: 73, tests: 74 }),
    ])
    expect(store.avgForTask('task-1')).toBe(72)
  })

  it('skips null dimension values when averaging', () => {
    const store = useMetricsStore()
    store.setScores('task-1', [
      makeScore({ completion: 100, quality: null, security: null, ux: null, tests: null }),
    ])
    expect(store.avgForTask('task-1')).toBe(100)
  })
})
