import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore, type Task } from './tasks'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    description: null,
    status: 'pending',
    agent_id: null,
    depends_on: null,
    created_at: '2026-04-01T00:00:00Z',
    started_at: null,
    finished_at: null,
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
// fetchTasks
// ──────────────────────────────────────────────

describe('fetchTasks()', () => {
  it('populates tasks on success', async () => {
    const store = useTasksStore()
    mockFetch([makeTask()])
    await store.fetchTasks()
    expect(store.tasks).toHaveLength(1)
    expect(store.error).toBeNull()
  })

  it('sets error on HTTP failure', async () => {
    const store = useTasksStore()
    mockFetch({}, false, 500)
    await store.fetchTasks()
    expect(store.error).toMatch(/HTTP 500/)
  })

  it('sets error on network failure', async () => {
    const store = useTasksStore()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    await store.fetchTasks()
    expect(store.error).toMatch(/Network error/)
  })
})

// ──────────────────────────────────────────────
// createTask
// ──────────────────────────────────────────────

describe('createTask()', () => {
  it('appends new task and returns it', async () => {
    const store = useTasksStore()
    const newTask = makeTask({ title: 'New one' })
    mockFetch(newTask)
    const result = await store.createTask({ title: 'New one' })
    expect(result).toMatchObject({ title: 'New one' })
    expect(store.tasks).toHaveLength(1)
  })

  it('returns null and sets error on failure', async () => {
    const store = useTasksStore()
    mockFetch({}, false, 400)
    const result = await store.createTask({ title: 'Bad' })
    expect(result).toBeNull()
    expect(store.error).toBeTruthy()
  })
})

// ──────────────────────────────────────────────
// deleteTask
// ──────────────────────────────────────────────

describe('deleteTask()', () => {
  it('removes task from the list', async () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 'abc' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await store.deleteTask('abc')
    expect(store.tasks).toHaveLength(0)
  })

  it('sets error on failure and keeps task', async () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 'abc' }))
    mockFetch({}, false, 500)
    await store.deleteTask('abc')
    expect(store.tasks).toHaveLength(1)
    expect(store.error).toBeTruthy()
  })
})

// ──────────────────────────────────────────────
// assignTask
// ──────────────────────────────────────────────

describe('assignTask()', () => {
  it('updates the task with the assigned agent', async () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 't1' }))
    const updated = makeTask({ id: 't1', agent_id: 'worker-1' })
    mockFetch(updated)
    await store.assignTask('t1', 'worker-1')
    expect(store.tasks[0]?.agent_id).toBe('worker-1')
  })

  it('sets error on failure', async () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 't1' }))
    mockFetch({}, false, 404)
    await store.assignTask('t1', 'ghost')
    expect(store.error).toBeTruthy()
  })
})

// ──────────────────────────────────────────────
// updateTaskStatus (called by WebSocket)
// ──────────────────────────────────────────────

describe('updateTaskStatus()', () => {
  it('updates status in place', () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 't1', status: 'pending' }))
    store.updateTaskStatus('t1', 'running', 'worker-1')
    expect(store.tasks[0]?.status).toBe('running')
    expect(store.tasks[0]?.agent_id).toBe('worker-1')
  })

  it('does nothing for unknown taskId', () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 't1' }))
    expect(() => store.updateTaskStatus('no-such', 'done', null)).not.toThrow()
    expect(store.tasks[0]?.status).toBe('pending')
  })

  it('does not overwrite agent_id when agentId is null', () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 't1', agent_id: 'worker-1' }))
    store.updateTaskStatus('t1', 'done', null)
    expect(store.tasks[0]?.agent_id).toBe('worker-1')
  })
})

// ──────────────────────────────────────────────
// byStatus (computed)
// ──────────────────────────────────────────────

describe('byStatus computed', () => {
  it('groups tasks correctly', () => {
    const store = useTasksStore()
    store.tasks.push(makeTask({ id: 't1', status: 'pending' }))
    store.tasks.push(makeTask({ id: 't2', status: 'running' }))
    store.tasks.push(makeTask({ id: 't3', status: 'done' }))
    store.tasks.push(makeTask({ id: 't4', status: 'done' }))
    store.tasks.push(makeTask({ id: 't5', status: 'failed' }))

    expect(store.byStatus.pending).toHaveLength(1)
    expect(store.byStatus.running).toHaveLength(1)
    expect(store.byStatus.done).toHaveLength(2)
    expect(store.byStatus.failed).toHaveLength(1)
  })

  it('all columns present even when empty', () => {
    const store = useTasksStore()
    expect(store.byStatus).toMatchObject({
      pending: [],
      running: [],
      done: [],
      failed: [],
    })
  })
})
