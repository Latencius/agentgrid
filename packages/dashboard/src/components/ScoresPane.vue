<template>
  <div class="scores-pane">
    <h2 class="scores-pane__title">Scores</h2>

    <div v-if="loading" class="scores-pane__loading">Loading tasks…</div>

    <div v-else-if="doneTasks.length === 0" class="scores-pane__empty">
      No completed tasks yet.
    </div>

    <div v-else class="scores-pane__grid">
      <ScoreCard
        v-for="task in doneTasks"
        :key="task.id"
        :taskId="task.id"
        :taskTitle="task.title"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useTasksStore } from '../stores/tasks'
import ScoreCard from './ScoreCard.vue'

const tasksStore = useTasksStore()
const loading = ref(false)

const doneTasks = computed(() => tasksStore.byStatus['done'])

onMounted(async () => {
  loading.value = true
  await tasksStore.fetchTasks()
  loading.value = false
})
</script>

<style scoped>
.scores-pane {
  padding: 16px;
  color: #d4d4d4;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.scores-pane__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #e8e8e8;
}

.scores-pane__loading,
.scores-pane__empty {
  color: #555;
  font-size: 14px;
  padding: 24px 0;
  text-align: center;
}

.scores-pane__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 14px;
}
</style>
