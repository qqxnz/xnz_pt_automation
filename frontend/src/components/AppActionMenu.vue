<template>
  <div ref="root" class="app-action-menu" :class="{ 'is-open': open }">
    <button class="app-action-menu-trigger" type="button" :aria-label="label" aria-haspopup="menu" :aria-expanded="open" @click.stop="open = !open">
      <span aria-hidden="true">···</span>
    </button>
    <button v-if="open" class="app-action-menu-backdrop" type="button" aria-label="关闭操作菜单" @click="close" />
    <div v-if="open" class="app-action-menu-panel" role="menu" :aria-label="label">
      <div class="app-action-menu-mobile-head">
        <strong>{{ label }}</strong>
        <button type="button" aria-label="关闭操作菜单" @click="close">×</button>
      </div>
      <button
        v-for="item in visibleItems"
        :key="item.key"
        type="button"
        role="menuitem"
        :class="{ danger: item.tone === 'danger', 'mobile-only': item.mobileOnly }"
        :disabled="item.disabled"
        :title="item.disabledReason || ''"
        @click="selectItem(item)"
      >
        <span>{{ item.label }}</span>
        <small v-if="item.disabled && item.disabledReason">{{ item.disabledReason }}</small>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'

export interface AppActionMenuItem {
  key: string
  label: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  disabledReason?: string
  hidden?: boolean
  mobileOnly?: boolean
}

const props = withDefaults(defineProps<{ items: AppActionMenuItem[]; label?: string }>(), { label: '更多操作' })
const emit = defineEmits<{ select: [key: string] }>()
const route = useRoute()
const root = ref<HTMLElement>()
const open = ref(false)
const visibleItems = computed(() => props.items.filter((item) => !item.hidden))

function close() { open.value = false }
function selectItem(item: AppActionMenuItem) {
  if (item.disabled) return
  emit('select', item.key)
  close()
}
function handleDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) close()
}
function handleKeydown(event: KeyboardEvent) { if (event.key === 'Escape') close() }

watch(() => route.fullPath, close)
onMounted(() => {
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('keydown', handleKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('keydown', handleKeydown)
})
</script>
