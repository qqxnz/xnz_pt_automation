<template>
  <div ref="containerRef" class="statistics-chart">
    <div v-if="!buckets.length" class="statistics-chart-empty">暂无流量数据</div>
    <template v-else>
      <div class="statistics-chart-legend">
        <span class="legend-item legend-upload"><i /> 上传</span>
        <span class="legend-item legend-download"><i /> 下载</span>
      </div>
      <svg
        class="statistics-chart-svg"
        :viewBox="`0 0 ${width} ${height}`"
        :width="width"
        :height="height"
        role="img"
        aria-label="流量趋势柱状图"
        @mouseleave="hoverIndex = -1"
      >
        <g class="chart-grid">
          <line
            v-for="tick in yTicks"
            :key="`g-${tick.value}`"
            :x1="paddingLeft"
            :x2="width - paddingRight"
            :y1="tick.y"
            :y2="tick.y"
            stroke="#eef2f7"
            stroke-width="1"
          />
        </g>
        <g class="chart-y-axis">
          <text
            v-for="tick in yTicks"
            :key="`y-${tick.value}`"
            :x="paddingLeft - 10"
            :y="tick.y + 4"
            text-anchor="end"
            class="chart-axis-label"
          >{{ tick.label }}</text>
        </g>
        <g class="chart-x-axis">
          <line
            :x1="paddingLeft"
            :x2="width - paddingRight"
            :y1="height - paddingBottom"
            :y2="height - paddingBottom"
            stroke="#dbe4f0"
            stroke-width="1"
          />
          <text
            v-for="(label, index) in displayLabels"
            :key="`x-${index}`"
            :x="xCenter(index)"
            :y="height - paddingBottom + 22"
            text-anchor="middle"
            class="chart-axis-label"
            :class="{ dim: label.dim }"
          >{{ label.text }}</text>
        </g>
        <g class="chart-bars">
          <g v-for="(bucket, index) in buckets" :key="`b-${index}`" class="chart-bar-group">
            <rect
              class="bar bar-upload"
              :x="barX(index, 'upload')"
              :y="barY(bucket.uploaded)"
              :width="barWidth"
              :height="Math.max(barHeight(bucket.uploaded), bucket.uploaded > 0 ? 2 : 0)"
              rx="3"
              @mouseenter="hoverIndex = index"
            />
            <rect
              class="bar bar-download"
              :x="barX(index, 'download')"
              :y="barY(bucket.downloaded)"
              :width="barWidth"
              :height="Math.max(barHeight(bucket.downloaded), bucket.downloaded > 0 ? 2 : 0)"
              rx="3"
              @mouseenter="hoverIndex = index"
            />
          </g>
        </g>
        <g v-if="hoverIndex >= 0 && buckets[hoverIndex]" class="chart-tooltip-group" :style="{ pointerEvents: 'none' }">
          <line
            :x1="xCenter(hoverIndex)"
            :x2="xCenter(hoverIndex)"
            :y1="paddingTop"
            :y2="height - paddingBottom"
            stroke="#c7d2e0"
            stroke-dasharray="3 3"
            stroke-width="1"
          />
        </g>
      </svg>
      <div
        v-if="hoverIndex >= 0 && buckets[hoverIndex]"
        class="statistics-chart-tooltip"
        :style="{ left: `${tooltipLeft}%` }"
      >
        <strong>{{ buckets[hoverIndex].label }}</strong>
        <span class="tooltip-row tooltip-upload"><i /> 上传 {{ formatBytes(buckets[hoverIndex].uploaded) }}</span>
        <span class="tooltip-row tooltip-download"><i /> 下载 {{ formatBytes(buckets[hoverIndex].downloaded) }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export type ChartBucket = {
  label: string
  uploaded: number
  downloaded: number
}

const props = withDefaults(
  defineProps<{
    buckets: ChartBucket[]
  }>(),
  {}
)

const containerRef = ref<HTMLDivElement | null>(null)
const containerWidth = ref(960)
const hoverIndex = ref(-1)

let resizeObserver: ResizeObserver | null = null

const height = 320
const paddingTop = 16
const paddingBottom = 44
const paddingLeft = 56
const paddingRight = 16

const width = computed(() => Math.max(containerWidth.value, 360))

const innerWidth = computed(() => width.value - paddingLeft - paddingRight)
const innerHeight = computed(() => height - paddingTop - paddingBottom)

const maxValue = computed(() => {
  let max = 0
  for (const bucket of props.buckets) {
    if (bucket.uploaded > max) max = bucket.uploaded
    if (bucket.downloaded > max) max = bucket.downloaded
  }
  return max
})

function niceMax(value: number) {
  if (value <= 0) return 1
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  const fraction = value / base
  let niceFraction: number
  if (fraction <= 1) niceFraction = 1
  else if (fraction <= 2) niceFraction = 2
  else if (fraction <= 5) niceFraction = 5
  else niceFraction = 10
  return niceFraction * base
}

const yTickCount = 4
const yTicks = computed(() => {
  const max = niceMax(maxValue.value)
  const step = max / yTickCount
  const ticks: Array<{ value: number; y: number; label: string }> = []
  for (let i = 0; i <= yTickCount; i += 1) {
    const value = step * i
    ticks.push({
      value,
      y: paddingTop + innerHeight.value - (value / max) * innerHeight.value,
      label: formatBytes(value)
    })
  }
  return ticks
})

const slotCount = computed(() => Math.max(props.buckets.length, 1))
const slotWidth = computed(() => innerWidth.value / slotCount.value)
const barWidth = computed(() => Math.max(Math.min(slotWidth.value * 0.36, 28), 3))
const barGap = computed(() => Math.max((slotWidth.value - barWidth.value * 2) / 3, 2))

function xCenter(index: number) {
  return paddingLeft + slotWidth.value * (index + 0.5)
}

function barX(index: number, kind: 'upload' | 'download') {
  const center = xCenter(index)
  if (kind === 'upload') {
    return center - barWidth.value - barGap.value / 2
  }
  return center + barGap.value / 2
}

function barY(value: number) {
  const max = niceMax(maxValue.value)
  if (max <= 0) return paddingTop + innerHeight.value
  return paddingTop + innerHeight.value - (value / max) * innerHeight.value
}

function barHeight(value: number) {
  return Math.max(innerHeight.value - (barY(value) - paddingTop), 0)
}

const displayLabels = computed(() => {
  const total = props.buckets.length
  if (total === 0) return []
  const maxLabels = Math.max(Math.floor(width.value / 70), 6)
  if (total <= maxLabels) {
    return props.buckets.map((b) => ({ text: b.label, dim: false }))
  }
  const step = Math.ceil(total / maxLabels)
  return props.buckets.map((b, index) => ({
    text: index % step === 0 || index === total - 1 ? b.label : '',
    dim: false
  }))
})

const tooltipLeft = computed(() => {
  if (hoverIndex.value < 0) return 0
  const center = xCenter(hoverIndex.value)
  const percent = (center / width.value) * 100
  return Math.min(Math.max(percent, 12), 88)
})

function formatBytes(value: number) {
  if (!value) return '0 B'
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
