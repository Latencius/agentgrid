<template>
  <div class="terminal" ref="containerRef">
    <div
      v-for="(line, i) in lines"
      :key="i"
      class="terminal__line"
    >{{ line }}</div>
    <div v-if="lines.length === 0" class="terminal__empty">No output yet.</div>
  </div>
</template>

<script setup lang="ts">
import { watch, nextTick, ref } from 'vue'

interface Props {
  lines: string[]
}

const props = defineProps<Props>()
const containerRef = ref<HTMLElement | null>(null)

watch(
  () => props.lines.length,
  async () => {
    await nextTick()
    if (containerRef.value) {
      containerRef.value.scrollTop = containerRef.value.scrollHeight
    }
  },
)
</script>

<style scoped>
.terminal {
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 8px 12px;
  height: 200px;
  overflow-y: auto;
  border-radius: 4px;
}

.terminal__line {
  white-space: pre-wrap;
  word-break: break-all;
}

.terminal__empty {
  color: #6a6a6a;
  font-style: italic;
}
</style>
