<template>
  <div class="task-board">
    <!-- Header -->
    <div class="task-board__header">
      <h2 class="task-board__title">Tasks</h2>
      <button class="task-board__btn task-board__btn--primary" @click="openCreateModal">
        + New Task
      </button>
    </div>

    <!-- Error banner -->
    <div v-if="tasksStore.error" class="task-board__error" role="alert">
      {{ tasksStore.error }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="task-board__loading">Loading tasks...</div>

    <!-- Kanban columns -->
    <div v-else class="task-board__columns">
      <div
        v-for="col in COLUMNS"
        :key="col.status"
        class="task-board__col"
        :data-status="col.status"
      >
        <div class="task-board__col-header">
          <span class="task-board__col-label" :class="`task-board__col-label--${col.status}`">
            {{ col.label }}
          </span>
          <span class="task-board__col-count">
            {{ tasksStore.byStatus[col.status].length }}
          </span>
        </div>

        <div class="task-board__cards">
          <!-- Empty column placeholder -->
          <div
            v-if="tasksStore.byStatus[col.status].length === 0"
            class="task-board__empty-col"
          >
            No tasks
          </div>

          <!-- Task cards -->
          <div
            v-for="task in tasksStore.byStatus[col.status]"
            :key="task.id"
            class="task-card"
            :data-testid="`task-card-${task.id}`"
          >
            <div class="task-card__title">{{ task.title }}</div>

            <p v-if="task.description" class="task-card__desc">
              {{ truncate(task.description, 80) }}
            </p>

            <div class="task-card__meta">
              <span v-if="task.agent_id" class="task-card__agent">
                {{ task.agent_id }}
              </span>
              <span class="task-card__date">{{ formatDate(task.created_at) }}</span>
            </div>

            <div class="task-card__actions">
              <button
                class="task-card__btn"
                :disabled="task.status !== 'pending'"
                @click="openAssignModal(task)"
              >
                Assign
              </button>
              <button
                class="task-card__btn task-card__btn--danger"
                :disabled="task.status === 'running'"
                @click="handleDelete(task.id)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Task Modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click.self="showCreateModal = false">
      <div class="modal" role="dialog" aria-labelledby="create-modal-title">
        <h3 id="create-modal-title" class="modal__title">New Task</h3>

        <div class="modal__field">
          <label for="task-title" class="modal__label">Title <span class="modal__required">*</span></label>
          <input
            id="task-title"
            v-model="createForm.title"
            class="modal__input"
            placeholder="Task title"
            @keyup.enter="submitCreate"
          />
        </div>

        <div class="modal__field">
          <label for="task-desc" class="modal__label">Description</label>
          <textarea
            id="task-desc"
            v-model="createForm.description"
            class="modal__input modal__textarea"
            placeholder="Optional description"
            rows="3"
          />
        </div>

        <p v-if="createError" class="modal__error">{{ createError }}</p>

        <div class="modal__actions">
          <button class="task-board__btn" @click="showCreateModal = false">Cancel</button>
          <button
            class="task-board__btn task-board__btn--primary"
            :disabled="createPending"
            @click="submitCreate"
          >
            {{ createPending ? 'Creating…' : 'Create' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Assign Agent Modal -->
    <div v-if="assigningTask" class="modal-overlay" @click.self="assigningTask = null">
      <div class="modal" role="dialog" aria-labelledby="assign-modal-title">
        <h3 id="assign-modal-title" class="modal__title">Assign Agent</h3>
        <p class="modal__sub">Task: <strong>{{ assigningTask.title }}</strong></p>

        <div class="modal__field">
          <label for="agent-select" class="modal__label">Agent</label>
          <select id="agent-select" v-model="selectedAgentId" class="modal__input modal__select">
            <option value="" disabled>— select an agent —</option>
            <option
              v-for="agent in agentsStore.agents"
              :key="agent.id"
              :value="agent.id"
            >
              {{ agent.id }} ({{ agent.status }})
            </option>
          </select>
        </div>

        <p v-if="assignError" class="modal__error">{{ assignError }}</p>

        <div class="modal__actions">
          <button class="task-board__btn" @click="assigningTask = null">Cancel</button>
          <button
            class="task-board__btn task-board__btn--primary"
            :disabled="!selectedAgentId || assignPending"
            @click="submitAssign"
          >
            {{ assignPending ? 'Assigning…' : 'Assign' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useTasksStore, type Task, type TaskStatus } from '../stores/tasks'
import { useAgentsStore } from '../stores/agents'

// ── Constants ─────────────────────────────────

interface Column { status: TaskStatus; label: string }

const COLUMNS: Column[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'running', label: 'Running' },
  { status: 'done',    label: 'Done'    },
  { status: 'failed',  label: 'Failed'  },
]

// ── Stores ────────────────────────────────────

const tasksStore  = useTasksStore()
const agentsStore = useAgentsStore()

// ── UI state ──────────────────────────────────

const loading         = ref(false)
const showCreateModal = ref(false)
const assigningTask   = ref<Task | null>(null)

const createForm    = ref({ title: '', description: '' })
const createError   = ref('')
const createPending = ref(false)

const selectedAgentId = ref('')
const assignError     = ref('')
const assignPending   = ref(false)

// ── Helpers ───────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + '…'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Actions ───────────────────────────────────

function openCreateModal(): void {
  createForm.value = { title: '', description: '' }
  createError.value = ''
  showCreateModal.value = true
}

function openAssignModal(task: Task): void {
  assigningTask.value = task
  selectedAgentId.value = task.agent_id ?? ''
  assignError.value = ''
}

async function submitCreate(): Promise<void> {
  const title = createForm.value.title.trim()
  if (!title) { createError.value = 'Title is required'; return }

  createPending.value = true
  createError.value = ''
  const result = await tasksStore.createTask({
    title,
    description: createForm.value.description.trim() || undefined,
  })
  createPending.value = false

  if (result) {
    showCreateModal.value = false
  } else {
    createError.value = tasksStore.error ?? 'Failed to create task'
  }
}

async function submitAssign(): Promise<void> {
  if (!assigningTask.value || !selectedAgentId.value) return

  assignPending.value = true
  assignError.value = ''
  await tasksStore.assignTask(assigningTask.value.id, selectedAgentId.value)
  assignPending.value = false

  if (!tasksStore.error) {
    assigningTask.value = null
  } else {
    assignError.value = tasksStore.error
  }
}

async function handleDelete(id: string): Promise<void> {
  if (!confirm('Delete this task?')) return
  await tasksStore.deleteTask(id)
}

// ── Lifecycle ─────────────────────────────────

onMounted(async () => {
  loading.value = true
  await Promise.all([tasksStore.fetchTasks(), agentsStore.fetchAgents()])
  loading.value = false
})
</script>

<style scoped>
/* ── Layout ──────────────────────────────────── */

.task-board {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  color: #d4d4d4;
}

.task-board__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.task-board__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #e8e8e8;
}

/* ── Buttons ──────────────────────────────────── */

.task-board__btn {
  padding: 6px 14px;
  border: 1px solid #3c3c3c;
  border-radius: 5px;
  background: #2d2d2d;
  color: #d4d4d4;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.task-board__btn:hover:not(:disabled) {
  background: #3a3a3a;
}

.task-board__btn--primary {
  background: #0e7fd0;
  border-color: #0e7fd0;
  color: #fff;
}

.task-board__btn--primary:hover:not(:disabled) {
  background: #1a91e8;
}

.task-board__btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ── Error / Loading ─────────────────────────── */

.task-board__error {
  background: #4a1a1a;
  color: #f88;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}

.task-board__loading {
  color: #666;
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}

/* ── Columns ──────────────────────────────────── */

.task-board__columns {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  align-items: start;
}

.task-board__col {
  background: #252525;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  overflow: hidden;
  min-height: 120px;
}

.task-board__col-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
}

.task-board__col-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.task-board__col-label--pending { color: #888; }
.task-board__col-label--running { color: #4ec9b0; }
.task-board__col-label--done    { color: #4ec94e; }
.task-board__col-label--failed  { color: #f44; }

.task-board__col-count {
  font-size: 12px;
  color: #555;
  background: #333;
  border-radius: 10px;
  padding: 1px 7px;
}

.task-board__cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}

.task-board__empty-col {
  color: #444;
  font-size: 12px;
  text-align: center;
  padding: 16px 0;
}

/* ── Task Card ───────────────────────────────── */

.task-card {
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-card__title {
  font-size: 13px;
  font-weight: 600;
  color: #e8e8e8;
  line-height: 1.3;
  word-break: break-word;
}

.task-card__desc {
  margin: 0;
  font-size: 12px;
  color: #888;
  line-height: 1.4;
}

.task-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-card__agent {
  font-size: 11px;
  color: #9cdcfe;
  background: #1a3a5c;
  border-radius: 3px;
  padding: 1px 6px;
  font-family: monospace;
}

.task-card__date {
  font-size: 11px;
  color: #555;
  margin-left: auto;
}

.task-card__actions {
  display: flex;
  gap: 6px;
}

.task-card__btn {
  padding: 3px 10px;
  border: 1px solid #3c3c3c;
  border-radius: 4px;
  background: #252525;
  color: #ccc;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
}

.task-card__btn:hover:not(:disabled) {
  background: #333;
}

.task-card__btn--danger:hover:not(:disabled) {
  background: #4a1a1a;
  border-color: #f44;
  color: #f88;
}

.task-card__btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* ── Modal ───────────────────────────────────── */

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  border-radius: 10px;
  padding: 24px;
  min-width: 360px;
  max-width: 480px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #e8e8e8;
}

.modal__sub {
  margin: 0;
  font-size: 13px;
  color: #888;
}

.modal__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.modal__label {
  font-size: 12px;
  color: #aaa;
  font-weight: 500;
}

.modal__required {
  color: #f44;
}

.modal__input {
  background: #1e1e1e;
  border: 1px solid #3c3c3c;
  border-radius: 5px;
  color: #d4d4d4;
  font-size: 13px;
  padding: 8px 10px;
  outline: none;
  width: 100%;
}

.modal__input:focus {
  border-color: #0e7fd0;
}

.modal__textarea {
  resize: vertical;
  font-family: inherit;
}

.modal__select {
  cursor: pointer;
}

.modal__error {
  margin: 0;
  font-size: 12px;
  color: #f88;
}

.modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
