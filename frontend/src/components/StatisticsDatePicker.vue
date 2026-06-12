<template>
  <div class="sdp">
    <button
      ref="triggerRef"
      type="button"
      class="sdp-trigger"
      :class="{ 'is-open': open, 'is-empty': !modelValue }"
      :aria-haspopup="'dialog'"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="sdp-trigger-text">{{ modelValue || placeholder || '选择日期' }}</span>
      <span class="sdp-trigger-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      </span>
    </button>

    <Teleport to="body">
      <Transition name="sdp-fade">
        <div v-if="open" class="sdp-mask" @click="close" />
      </Transition>
      <Transition name="sdp-slide">
        <div
          v-if="open"
          ref="sheetRef"
          class="sdp-sheet"
          role="dialog"
          aria-modal="true"
          :aria-label="title || '选择日期'"
          @keydown.esc="close"
        >
          <div class="sdp-handle" aria-hidden="true" />
          <div class="sdp-header">
            <button type="button" class="sdp-nav" aria-label="上一月" @click="shiftMonth(-1)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div class="sdp-title">{{ view.year }} 年 {{ view.month + 1 }} 月</div>
            <button type="button" class="sdp-nav" aria-label="下一月" @click="shiftMonth(1)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
          <div class="sdp-weekdays">
            <span v-for="(w, i) in weekdays" :key="i">{{ w }}</span>
          </div>
          <div class="sdp-grid">
            <span v-for="(cell, idx) in cells" :key="idx" class="sdp-cell-wrap">
              <button
                v-if="cell.day"
                type="button"
                class="sdp-day"
                :class="{
                  'is-today': cell.today,
                  'is-selected': cell.selected,
                  'is-disabled': cell.disabled
                }"
                :disabled="cell.disabled"
                @click="pickDay(cell)"
              >{{ cell.day }}</button>
              <span v-else class="sdp-day is-empty" />
            </span>
          </div>
          <div class="sdp-footer">
            <button type="button" class="sdp-foot-btn" @click="pickToday" :disabled="!canPickToday">今天</button>
            <button type="button" class="sdp-foot-btn sdp-foot-primary" @click="close">关闭</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    min?: string
    max?: string
    placeholder?: string
    title?: string
  }>(),
  {}
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'change', value: string): void
}>()

const weekdays = ['一', '二', '三', '四', '五', '六', '日']

const open = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)
const sheetRef = ref<HTMLDivElement | null>(null)

const today = new Date()
const todayKey = dateKey(today)

function dateKey(value: Date): string {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseKey(value: string | undefined): Date | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

const selectedDate = computed(() => parseKey(props.modelValue))

const view = ref<{ year: number; month: number }>(initialView())

function initialView(): { year: number; month: number } {
  const d = selectedDate.value ?? today
  return { year: d.getFullYear(), month: d.getMonth() }
}

watch(
  () => props.modelValue,
  () => {
    const d = selectedDate.value
    if (d) view.value = { year: d.getFullYear(), month: d.getMonth() }
  }
)

function shiftMonth(delta: number) {
  const next = new Date(view.value.year, view.value.month + delta, 1)
  view.value = { year: next.getFullYear(), month: next.getMonth() }
}

type Cell = { day: number | null; date?: Date; key?: string; today?: boolean; selected?: boolean; disabled?: boolean }

const cells = computed<Cell[]>(() => {
  const first = new Date(view.value.year, view.value.month, 1)
  const startWeekday = (first.getDay() + 6) % 7
  const daysInMonth = new Date(view.value.year, view.value.month + 1, 0).getDate()
  const out: Cell[] = []
  for (let i = 0; i < startWeekday; i++) out.push({ day: null })
  const min = parseKey(props.min)
  const max = parseKey(props.max)
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(view.value.year, view.value.month, d)
    const key = dateKey(date)
    out.push({
      day: d,
      date,
      key,
      today: key === todayKey,
      selected: selectedDate.value ? key === props.modelValue : false,
      disabled: (!!min && key < (props.min as string)) || (!!max && key > (props.max as string))
    })
  }
  while (out.length % 7 !== 0) out.push({ day: null })
  return out
})

const canPickToday = computed(() => {
  if (!props.max && !props.min) return true
  if (props.max && todayKey > props.max) return false
  if (props.min && todayKey < props.min) return false
  return true
})

function pickDay(cell: Cell) {
  if (cell.disabled || !cell.key) return
  emit('update:modelValue', cell.key)
  emit('change', cell.key)
  close()
}

function pickToday() {
  if (!canPickToday.value) return
  emit('update:modelValue', todayKey)
  emit('change', todayKey)
  close()
}

function toggle() {
  if (open.value) close()
  else openIt()
}

function openIt() {
  const d = selectedDate.value ?? today
  view.value = { year: d.getFullYear(), month: d.getMonth() }
  open.value = true
  nextTick(() => sheetRef.value?.focus())
}

function close() {
  open.value = false
  nextTick(() => triggerRef.value?.focus())
}

function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close()
}

watch(open, (v) => {
  if (typeof document === 'undefined') return
  if (v) document.addEventListener('keydown', onDocKey)
  else document.removeEventListener('keydown', onDocKey)
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('keydown', onDocKey)
})
</script>

<style scoped>
.sdp {
  position: relative;
  display: inline-flex;
  width: 100%;
  min-width: 0;
}

.sdp-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  min-width: 0;
  padding: 0 14px;
  border: 1px solid #dbe4f0;
  border-radius: 14px;
  background: #f9fafb;
  color: #111827;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  box-sizing: border-box;
}

.sdp-trigger:hover {
  border-color: #93b4ff;
}

.sdp-trigger.is-open,
.sdp-trigger:focus,
.sdp-trigger:focus-visible {
  outline: none;
  border-color: #3f7cff;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(63, 124, 255, 0.18);
}

.sdp-trigger.is-empty {
  color: #9ca3af;
  font-weight: 500;
}

.sdp-trigger-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdp-trigger-icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #6b7280;
  line-height: 1;
}

.sdp-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 200;
}

.sdp-sheet {
  position: fixed;
  left: 50%;
  bottom: 0;
  transform: translateX(-50%);
  width: min(420px, 100%);
  max-height: 85vh;
  background: #fff;
  border-top-left-radius: 20px;
  border-top-right-radius: 20px;
  padding: 10px 12px 16px;
  z-index: 201;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 -10px 30px rgba(15, 23, 42, 0.18);
  box-sizing: border-box;
  outline: none;
  font-family: inherit;
}

.sdp-handle {
  width: 40px;
  height: 4px;
  background: #e2e8f0;
  border-radius: 999px;
  margin: 0 auto 2px;
}

.sdp-header {
  display: grid;
  grid-template-columns: 40px 1fr 40px;
  align-items: center;
  gap: 8px;
  color: #0f172a;
  font-size: 16px;
  font-weight: 700;
  padding: 4px 4px 2px;
}

.sdp-title {
  text-align: center;
  user-select: none;
  letter-spacing: 0.02em;
}

.sdp-nav {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  background: #f1f5f9;
  color: #475569;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.sdp-nav:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.sdp-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  color: #94a3b8;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  padding: 0 2px;
}

.sdp-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  padding: 0 2px;
}

.sdp-cell-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
}

.sdp-day {
  width: 100%;
  aspect-ratio: 1 / 1;
  min-height: 40px;
  border: 0;
  background: transparent;
  border-radius: 10px;
  color: #1f2937;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, transform 0.12s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.sdp-day.is-empty {
  cursor: default;
}

.sdp-day:hover:not(.is-empty):not(.is-disabled) {
  background: #eff6ff;
  color: #1d4ed8;
}

.sdp-day.is-today {
  color: #3f7cff;
  box-shadow: inset 0 0 0 1.5px #3f7cff;
}

.sdp-day.is-selected {
  background: #3f7cff;
  color: #fff;
  box-shadow: none;
}

.sdp-day.is-disabled {
  color: #cbd5e1;
  cursor: not-allowed;
}

.sdp-day.is-disabled:hover {
  background: transparent;
  color: #cbd5e1;
}

.sdp-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
  padding: 6px 4px 0;
  border-top: 1px solid #e5e7eb;
  margin-top: 4px;
}

.sdp-foot-btn {
  border: 0;
  background: #f1f5f9;
  color: #475569;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.sdp-foot-btn:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

.sdp-foot-btn:disabled {
  color: #cbd5e1;
  cursor: not-allowed;
}

.sdp-foot-primary {
  background: #3f7cff;
  color: #fff;
}

.sdp-foot-primary:hover {
  background: #2563eb;
  color: #fff;
}

.sdp-fade-enter-active,
.sdp-fade-leave-active {
  transition: opacity 0.18s ease;
}
.sdp-fade-enter-from,
.sdp-fade-leave-to {
  opacity: 0;
}

.sdp-slide-enter-active,
.sdp-slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.18s ease;
}
.sdp-slide-enter-from,
.sdp-slide-leave-to {
  transform: translate(-50%, 100%);
  opacity: 0;
}

@media (max-width: 720px) {
  .sdp-trigger {
    min-height: 52px;
    font-size: 16px;
  }
  .sdp-day {
    min-height: 44px;
    font-size: 15px;
  }
}
</style>
