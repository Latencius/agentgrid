import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  agent_id: string | null
  depends_on: string[] | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface CreateTaskInput {
  title: string
  description?: string
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

export const useTasksStore = defineStore('tasks', () => {
  const tasks = ref<Task[]>([])
  const error = ref<string | null>(null)

  // ── Computed ──────────────────────────────────

  const byStatus = computed((): Record<TaskStatus, Task[]> => {
    const map: Record<TaskStatus, Task[]> = {
      pending: [],
      running: [],
      done: [],
      failed: [],
    }
    for (const task of tasks.value) {
      map[task.status].push(task)
    }
    return map
  })

  // ── Actions ───────────────────────────────────

  async function fetchTasks(): Promise<void> {
    try {
      const res = await fetch('/api/tasks')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      tasks.value = (await res.json()) as Task[]
      error.value = null
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  async function createTask(input: CreateTaskInput): Promise<Task | null> {
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const task = (await res.json()) as Task
      tasks.value.push(task)
      error.value = null
      return task
    } catch (err: unknown) {
      error.value = String(err)
      return null
    }
  }

  async function deleteTask(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      tasks.value = tasks.value.filter((t) => t.id !== id)
      error.value = null
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  async function assignTask(taskId: string, agentId: string): Promise<void> {
    try {
      const res = await fetch(`/api/tasks/${taskId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const updated = (await res.json()) as Task
      const idx = tasks.value.findIndex((t) => t.id === taskId)
      if (idx !== -1) tasks.value[idx] = updated
      error.value = null
    } catch (err: unknown) {
      error.value = String(err)
    }
  }

  /** Called by useWebSocket when a task:status event arrives. */
  function updateTaskStatus(taskId: string, status: TaskStatus, agentId: string | null): void {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task) return
    task.status = status
    if (agentId !== null) task.agent_id = agentId
  }

  return {
    tasks,
    error,
    byStatus,
    fetchTasks,
    createTask,
    deleteTask,
    assignTask,
    updateTaskStatus,
  }
})
