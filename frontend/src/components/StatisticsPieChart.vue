<template>
  <div ref="containerRef" class="statistics-pie">
    <div v-if="!slices.length" class="statistics-pie-empty">{{ emptyText || '暂无流量数据' }}</div>
    <div v-else class="statistics-pie-body">
      <div class="statistics-pie-chart">
        <svg
          class="statistics-pie-svg"
          :viewBox="`0 0 ${width} ${height}`"
          :width="width"
          :height="height"
          role="img"
          aria-label="流量占比饼图"
          @mouseleave="onSvgLeave"
          @click="onSvgClick"
        >
          <g class="pie-slices">
            <path
              v-for="(slice, index) in slices"
              :key="`s-${index}`"
              class="pie-slice"
              :class="{ active: activeIndex === index }"
              :d="slicePath(index)"
              :fill="slice.color"
              stroke="#ffffff"
              stroke-width="1"
              @mouseenter="setHover(index)"
              @click.stop="onSliceClick(index)"
            />
          </g>
          <g v-if="calloutLine" class="pie-callout">
            <line
              :x1="calloutLine.x1"
              :y1="calloutLine.y1"
              :x2="calloutLine.x2"
              :y2="calloutLine.y2"
              :stroke="calloutColor"
              stroke-width="1.5"
            />
            <circle
              :cx="calloutLine.x1"
              :cy="calloutLine.y1"
              :r="3"
              :fill="calloutColor"
            />
          </g>
          <g class="pie-labels">
            <text
              v-for="(slice, index) in labelSlices"
              :key="`l-${index}`"
              class="pie-slice-label"
              :x="labelPosition(slice).x"
              :y="labelPosition(slice).y"
            >{{ formatValue(slice.value) }}</text>
          </g>
        </svg>
        <div
          v-if="calloutBox"
          class="statistics-pie-callout-box"
          :style="{
            left: `${calloutBox.x}px`,
            top: `${calloutBox.y}px`,
            background: calloutColor,
            borderColor: calloutColor
          }"
        >
          <strong>{{ calloutName }}</strong>
          <span>{{ calloutValueText }}</span>
        </div>
      </div>
      <ul class="statistics-pie-legend">
        <li
          v-for="(slice, index) in slices"
          :key="`lg-${index}`"
          :class="{ active: activeIndex === index }"
          @mouseenter="setHover(index)"
          @mouseleave="onLegendLeave(index)"
          @click="onSliceClick(index)"
        >
          <i :style="{ background: slice.color }" />
          <span>{{ slice.name }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export type PieSlice = {
  name: string
  value: number
  color: string
  percent: number
}

const props = withDefaults(
  defineProps<{
    slices: PieSlice[]
    emptyText?: string
  }>(),
  {}
)

const containerRef = ref<HTMLDivElement | null>(null)
const containerWidth = ref(360)
const hoverIndex = ref(-1)
const pinnedIndex = ref(-1)

let resizeObserver: ResizeObserver | null = null

const height = 240
const padding = 12
const legendWidth = 120

const chartWidth = computed(() => Math.max(containerWidth.value - legendWidth, 180))
const width = computed(() => chartWidth.value)

const cx = computed(() => width.value / 2)
const cy = computed(() => height / 2)
const radius = computed(() => Math.max(Math.min(width.value, height) / 2 - padding, 24))

const total = computed(() => props.slices.reduce((sum, s) => sum + s.value, 0))

type AngleSlice = PieSlice & { startAngle: number; endAngle: number; midAngle: number }

const angleSlices = computed<AngleSlice[]>(() => {
  if (total.value <= 0) return []
  let cursor = -Math.PI / 2
  return props.slices.map((s) => {
    const angle = (s.value / total.value) * Math.PI * 2
    const startAngle = cursor
    const endAngle = cursor + angle
    const midAngle = (startAngle + endAngle) / 2
    cursor = endAngle
    return { ...s, startAngle, endAngle, midAngle }
  })
})

function polar(angle: number, r: number) {
  return { x: cx.value + Math.cos(angle) * r, y: cy.value + Math.sin(angle) * r }
}

function arcPath(start: { x: number; y: number }, end: { x: number; y: number }, largeArc: number) {
  return `A ${radius.value} ${radius.value} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function slicePath(index: number) {
  const slice = angleSlices.value[index]
  if (!slice || radius.value <= 0) return ''
  if (slice.endAngle - slice.startAngle >= Math.PI * 2 - 1e-6) {
    return `M ${cx.value} ${cy.value} m ${-radius.value} 0 a ${radius.value} ${radius.value} 0 1 0 ${radius.value * 2} 0 a ${radius.value} ${radius.value} 0 1 0 ${-radius.value * 2} 0`
  }
  const start = polar(slice.startAngle, radius.value)
  const end = polar(slice.endAngle, radius.value)
  const largeArc = slice.endAngle - slice.startAngle > Math.PI ? 1 : 0
  return `M ${cx.value} ${cy.value} L ${start.x} ${start.y} ${arcPath(start, end, largeArc)} Z`
}

function labelPosition(slice: AngleSlice) {
  const r = radius.value * 0.62
  return polar(slice.midAngle, r)
}

const labelSlices = computed(() => angleSlices.value.filter((s) => s.percent >= 8))

const activeIndex = computed(() => (pinnedIndex.value >= 0 ? pinnedIndex.value : hoverIndex.value))

const callout = computed(() => {
  if (activeIndex.value < 0) return null
  const slice = angleSlices.value[activeIndex.value]
  if (!slice) return null
  const edge = polar(slice.midAngle, radius.value)
  const tip = polar(slice.midAngle, radius.value + 18)
  return {
    color: slice.color,
    name: slice.name,
    value: slice.value,
    line: { x1: edge.x, y1: edge.y, x2: tip.x, y2: tip.y }
  }
})

const calloutColor = computed(() => callout.value?.color ?? '#3f7cff')
const calloutName = computed(() => callout.value?.name ?? '')
const calloutValueText = computed(() => (callout.value ? formatValue(callout.value.value) : ''))
const calloutLine = computed(() => callout.value?.line ?? null)

const calloutBox = computed(() => {
  if (!callout.value) return null
  const slice = angleSlices.value[activeIndex.value]
  const tip = polar(slice.midAngle, radius.value + 18)
  const halfW = 64
  const halfH = 22
  let x = tip.x
  let y = tip.y - halfH
  const dirX = Math.cos(slice.midAngle)
  if (dirX >= 0) {
    x = tip.x + 4
  } else {
    x = tip.x - 4 - halfW * 2
  }
  x = Math.min(Math.max(x, 4), width.value - halfW * 2 - 4)
  y = Math.min(Math.max(y, 4), height - halfH * 2 - 4)
  return { x, y }
})

function setHover(index: number) {
  hoverIndex.value = index
}

function onLegendLeave(index: number) {
  if (hoverIndex.value === index && pinnedIndex.value < 0) {
    hoverIndex.value = -1
  }
}

function onSvgLeave() {
  if (pinnedIndex.value < 0) {
    hoverIndex.value = -1
  }
}

function onSliceClick(index: number) {
  if (pinnedIndex.value === index) {
    pinnedIndex.value = -1
  } else {
    pinnedIndex.value = index
  }
}

function onSvgClick(event: MouseEvent) {
  if ((event.target as Element | null)?.tagName !== 'svg' && (event.target as Element | null)?.closest('.pie-slice')) return
}

function formatValue(value: number) {
  if (!value) return '0'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`
}

function measure() {
  if (containerRef.value) {
    containerWidth.value = containerRef.value.clientWidth
  }
}

onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && containerRef.value) {
    resizeObserver = new ResizeObserver(() => measure())
    resizeObserver.observe(containerRef.value)
  } else {
    window.addEventListener('resize', measure)
  }
})

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  } else {
    window.removeEventListener('resize', measure)
  }
})
</script>
