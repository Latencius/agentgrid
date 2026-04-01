import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia, type Pinia } from 'pinia'
import TaskBoard from './TaskBoard.vue'
import { useTasksStore, type Task } from '../stores/tasks'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${Math.random().toString(36).slice(2)}`,
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

// Mount TaskBoard with a shared Pinia instance and return both wrapper + store.
function mountBoard(pinia: Pinia) {
  const wrapper = mount(TaskBoard, {
    global: { plugins: [pinia] },
  })
  const tasksStore = useTasksStore()
  return { wrapper, tasksStore }
}

// ──────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────

let pinia: Pinia

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  vi.unstubAllGlobals()
  // Default: fetch returns empty arrays for both tasks and agents
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
})

// ──────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────

describe('TaskBoard rendering', () => {
  it('renders the board title', async () => {
    const { wrapper } = mountBoard(pinia)
    await flushPromises()
    expect(wrapper.text()).toContain('Tasks')
  })

  it('renders all four status columns', async () => {
    const { wrapper } = mountBoard(pinia)
    await flushPromises()
    expect(wrapper.text()).toContain('Pending')
    expect(wrapper.text()).toContain('Running')
    expect(wrapper.text()).toContain('Done')
    expect(wrapper.text()).toContain('Failed')
  })

  it('shows "New Task" button', async () => {
    const { wrapper } = mountBoard(pinia)
    await flushPromises()
    expect(wrapper.find('button').text()).toContain('New Task')
  })

  it('renders task cards from the store', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', title: 'My task', status: 'pending' }))
    await nextTick()
    expect(wrapper.text()).toContain('My task')
  })

  it('puts tasks in the correct column', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', title: 'Done task', status: 'done' }))
    await nextTick()

    const doneCol = wrapper.find('[data-status="done"]')
    expect(doneCol.text()).toContain('Done task')

    const pendingCol = wrapper.find('[data-status="pending"]')
    expect(pendingCol.text()).not.toContain('Done task')
  })

  it('shows agent badge when task has agent_id', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', agent_id: 'worker-1' }))
    await nextTick()
    expect(wrapper.text()).toContain('worker-1')
  })

  it('shows column counts', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ status: 'pending' }))
    tasksStore.tasks.push(makeTask({ status: 'pending' }))
    tasksStore.tasks.push(makeTask({ status: 'done' }))
    await nextTick()

    const pendingCol = wrapper.find('[data-status="pending"]')
    expect(pendingCol.find('.task-board__col-count').text()).toBe('2')
  })
})

// ──────────────────────────────────────────────
// Create task modal
// ──────────────────────────────────────────────

describe('Create task modal', () => {
  it('is hidden initially', async () => {
    const { wrapper } = mountBoard(pinia)
    await flushPromises()
    expect(wrapper.find('.modal').exists()).toBe(false)
  })

  it('opens when New Task button is clicked', async () => {
    const { wrapper } = mountBoard(pinia)
    await flushPromises()
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('.modal').exists()).toBe(true)
    expect(wrapper.find('#create-modal-title').text()).toContain('New Task')
  })

  it('closes when Cancel is clicked', async () => {
    const { wrapper } = mountBoard(pinia)
    await wrapper.find('button').trigger('click')

    const cancelBtn = wrapper.findAll('.modal .task-board__btn').find(b => b.text() === 'Cancel')
    await cancelBtn!.trigger('click')
    expect(wrapper.find('.modal').exists()).toBe(false)
  })

  it('shows validation error when title is empty', async () => {
    const { wrapper } = mountBoard(pinia)
    await wrapper.find('button').trigger('click')

    const createBtn = wrapper.findAll('.modal .task-board__btn--primary')[0]
    await createBtn!.trigger('click')
    expect(wrapper.text()).toContain('Title is required')
  })

  it('calls createTask and closes modal on success', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    const createSpy = vi.spyOn(tasksStore, 'createTask').mockResolvedValue(
      makeTask({ id: 'new-1', title: 'Created' })
    )

    await wrapper.find('button').trigger('click')
    await wrapper.find('#task-title').setValue('Created')
    await wrapper.findAll('.modal .task-board__btn--primary')[0]!.trigger('click')
    await flushPromises()

    expect(createSpy).toHaveBeenCalledWith({ title: 'Created', description: undefined })
    expect(wrapper.find('.modal').exists()).toBe(false)
  })
})

// ──────────────────────────────────────────────
// Delete task
// ──────────────────────────────────────────────

describe('Delete task', () => {
  it('calls deleteTask when confirm is accepted', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', status: 'pending' }))
    const deleteSpy = vi.spyOn(tasksStore, 'deleteTask').mockResolvedValue()
    await nextTick()

    const deleteBtn = wrapper.find('.task-card__btn--danger')
    await deleteBtn.trigger('click')
    expect(deleteSpy).toHaveBeenCalledWith('t1')
  })

  it('does not call deleteTask when confirm is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false))

    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', status: 'pending' }))
    const deleteSpy = vi.spyOn(tasksStore, 'deleteTask').mockResolvedValue()
    await nextTick()

    await wrapper.find('.task-card__btn--danger').trigger('click')
    expect(deleteSpy).not.toHaveBeenCalled()
  })

  it('Delete button is disabled on running tasks', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', status: 'running' }))
    await nextTick()

    const deleteBtn = wrapper.find('[data-status="running"] .task-card__btn--danger')
    expect((deleteBtn.element as HTMLButtonElement).disabled).toBe(true)
  })
})

// ──────────────────────────────────────────────
// Assign task modal
// ──────────────────────────────────────────────

describe('Assign task modal', () => {
  it('opens when Assign is clicked on a pending task', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', title: 'My pending', status: 'pending' }))
    await nextTick()

    const assignBtn = wrapper.find('[data-status="pending"] .task-card__btn:not(.task-card__btn--danger)')
    await assignBtn.trigger('click')
    expect(wrapper.find('#assign-modal-title').exists()).toBe(true)
    expect(wrapper.text()).toContain('My pending')
  })

  it('Assign button is disabled on non-pending tasks', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', status: 'running' }))
    await nextTick()

    const assignBtn = wrapper.find('[data-status="running"] .task-card__btn:not(.task-card__btn--danger)')
    expect((assignBtn.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('calls assignTask when agent is selected and confirmed', async () => {
    const { wrapper, tasksStore } = mountBoard(pinia)
    const assignSpy = vi.spyOn(tasksStore, 'assignTask').mockResolvedValue()

    // Inject agent directly into agents store
    const { useAgentsStore } = await import('../stores/agents')
    const agentsStore = useAgentsStore()
    agentsStore.agents.push({
      id: 'worker-1', type: 'claude-code', runner: 'pty',
      status: 'idle', worktree: null, current_task_id: null,
      tokens_used: 0, cost_usd: 0, created_at: '2026-04-01T00:00:00Z',
    })

    await flushPromises()
    tasksStore.tasks.push(makeTask({ id: 't1', status: 'pending' }))
    await nextTick()
    await wrapper.find('[data-status="pending"] .task-card__btn:not(.task-card__btn--danger)').trigger('click')

    await wrapper.find('#agent-select').setValue('worker-1')
    const confirmBtn = wrapper.findAll('.modal .task-board__btn--primary').find(b => b.text().includes('Assign'))
    await confirmBtn!.trigger('click')
    await flushPromises()

    expect(assignSpy).toHaveBeenCalledWith('t1', 'worker-1')
  })
})
