<template>
  <AppLayout>
    <section class="feature-page statistics-page">
      <div class="dashboard-head">
        <div>
          <h1>流量</h1>
          <p>按来源站点和日期统计 qBittorrent 种子的实际上传、下载增量。</p>
        </div>
      </div>

      <section class="site-stats statistics-summary">
        <article class="metric-card"><span>总上传</span><strong class="success">{{ formatBytes(result.allTimeUploaded) }}</strong></article>
        <article class="metric-card"><span>总下载</span><strong>{{ formatBytes(result.allTimeDownloaded) }}</strong></article>
        <article class="metric-card"><span>总站点数</span><strong>{{ result.allTimeSiteCount }}</strong></article>
      </section>

      <section class="sites-toolbar statistics-toolbar panel">
        <div class="statistics-date-cell">
          <span class="statistics-date-label">开始日期</span>
          <button
            type="button"
            class="statistics-date-trigger"
            :class="{ 'is-empty': !filters.startDate }"
            @click="openPicker('start')"
          >
            <span class="statistics-date-text">{{ filters.startDate || '选择开始日期' }}</span>
            <span class="statistics-date-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </span>
          </button>
        </div>
        <div class="statistics-date-cell">
          <span class="statistics-date-label">结束日期</span>
          <button
            type="button"
            class="statistics-date-trigger"
            :class="{ 'is-empty': !filters.endDate }"
            @click="openPicker('end')"
          >
            <span class="statistics-date-text">{{ filters.endDate || '选择结束日期' }}</span>
            <span class="statistics-date-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </span>
          </button>
        </div>
      </section>

      <VarPopup
        v-model:show="startPicker.show"
        position="bottom"
        :overlay-style="{ background: 'rgba(15, 23, 42, 0.45)' }"
        :close-on-click-overlay="true"
        :safe-area="true"
        @closed="startPicker.show = false"
      >
        <div class="statistics-date-sheet">
          <div class="statistics-date-sheet-header">
            <strong>选择开始日期</strong>
            <button type="button" class="statistics-date-sheet-close" @click="startPicker.show = false">关闭</button>
          </div>
          <VarDatePicker
            v-model="startPicker.value"
            type="date"
            :max="startPicker.max"
            header-color="#3f7cff"
            color="#3f7cff"
            first-day-of-week="1"
            :show-current="true"
            @change="onStartChange"
          />
        </div>
      </VarPopup>

      <VarPopup
        v-model:show="endPicker.show"
        position="bottom"
        :overlay-style="{ background: 'rgba(15, 23, 42, 0.45)' }"
        :close-on-click-overlay="true"
        :safe-area="true"
        @closed="endPicker.show = false"
      >
        <div class="statistics-date-sheet">
          <div class="statistics-date-sheet-header">
            <strong>选择结束日期</strong>
            <button type="button" class="statistics-date-sheet-close" @click="endPicker.show = false">关闭</button>
          </div>
          <VarDatePicker
            v-model="endPicker.value"
            type="date"
            :min="endPicker.min"
            header-color="#3f7cff"
            color="#3f7cff"
            first-day-of-week="1"
            :show-current="true"
            @change="onEndChange"
          />
        </div>
      </VarPopup>

      <section class="panel statistics-chart-panel">
        <div class="panel-title-row">
          <h2>流量趋势</h2>
        </div>
        <div v-if="error" class="error-banner">{{ error }}<button type="button" @click="loadStatistics">重试</button></div>
        <div class="statistics-pie-grid">
          <div class="statistics-pie-card">
            <div class="statistics-pie-card-title">上传 共 <strong>{{ formatBytes(result.totalUploaded) }}</strong></div>
            <StatisticsPieChart :slices="uploadSlices" empty-text="暂无上传数据" />
          </div>
          <div class="statistics-pie-card">
            <div class="statistics-pie-card-title">下载 共 <strong>{{ formatBytes(result.totalDownloaded) }}</strong></div>
            <StatisticsPieChart :slices="downloadSlices" empty-text="暂无下载数据" />
          </div>
        </div>
      </section>

      <section class="panel statistics-list-panel">
        <div class="panel-title-row">
          <h2>站点流量</h2>
          <span>共 {{ result.total }} 个站点</span>
        </div>
        <div v-if="!result.items.length && !loading" class="sites-empty">
          <h2>当前区间暂无流量</h2>
          <p>种子同步产生上传或下载增量后，会在这里按日期累计。</p>
        </div>
        <div v-else class="statistics-site-list">
          <details v-for="site in result.items" :key="site.siteId" class="statistics-site-card">
            <summary>
              <span class="statistics-site-name">
                <strong>{{ site.siteName }}</strong>
                <span v-if="site.siteDeleted" class="chip muted-chip">站点已删除</span>
              </span>
              <span class="statistics-site-stat"><small>上传</small><strong class="success">{{ formatBytes(site.uploaded) }}<span class="statistics-site-divider">|</span><span class="statistics-site-share">{{ formatShare(site.uploaded, result.totalUploaded) }}</span></strong></span>
              <span class="statistics-site-stat"><small>下载</small><strong>{{ formatBytes(site.downloaded) }}<span class="statistics-site-divider">|</span><span class="statistics-site-share">{{ formatShare(site.downloaded, result.totalDownloaded) }}</span></strong></span>
            </summary>
            <div class="statistics-daily-table">
              <div class="statistics-daily-row statistics-daily-head"><span>日期</span><span>上传增量</span><span>下载增量</span></div>
              <div v-for="day in site.daily" :key="day.date" class="statistics-daily-row">
                <span>{{ day.date }}</span><span>{{ formatBytes(day.uploaded) }}</span><span>{{ formatBytes(day.downloaded) }}</span>
              </div>
            </div>
          </details>
        </div>

        <div v-if="result.total > filters.pageSize" class="pagination">
          <button type="button" :disabled="filters.page <= 1 || loading" @click="changePage(filters.page - 1)">上一页</button>
          <span>第 {{ filters.page }} / {{ totalPages }} 页</span>
          <button type="button" :disabled="filters.page >= totalPages || loading" @click="changePage(filters.page + 1)">下一页</button>
        </div>
      </section>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import StatisticsPieChart, { type PieSlice } from '../components/StatisticsPieChart.vue'
import { getSiteStatistics, type SiteStatisticsResponse } from '../api/siteStatistics'
import { Popup as VarPopup, DatePicker as VarDatePicker, Snackbar } from '@varlet/ui'

function dateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = new Date()
const filters = reactive({
  startDate: dateKey(today),
  endDate: dateKey(today),
  siteId: '',
  page: 1,
  pageSize: 20
})
const startDateInput = ref<HTMLInputElement | null>(null)
const endDateInput = ref<HTMLInputElement | null>(null)

const startPicker = reactive<{ show: boolean; value: string; max: string }>({
  show: false,
  value: filters.startDate,
  max: dateKey(today)
})
const endPicker = reactive<{ show: boolean; value: string; min?: string }>({
  show: false,
  value: filters.endDate,
  min: filters.startDate
})

function openPicker(which: 'start' | 'end') {
  if (which === 'start') {
    startPicker.value = filters.startDate
    startPicker.show = true
  } else {
    endPicker.value = filters.endDate
    endPicker.min = filters.startDate || undefined
    endPicker.show = true
  }
}

function onStartChange(value: string | string[]) {
  const v = Array.isArray(value) ? value[0] : value
  if (!v) return
  if (filters.endDate && v > filters.endDate) {
    filters.endDate = v
    endPicker.value = v
  }
  filters.startDate = v
  endPicker.min = v
  startPicker.show = false
  autoSearch()
}

function onEndChange(value: string | string[]) {
  const v = Array.isArray(value) ? value[0] : value
  if (!v) return
  if (filters.startDate && v < filters.startDate) {
    Snackbar.warning('结束日期不能早于开始日期')
    endPicker.value = filters.endDate
    return
  }
  filters.endDate = v
  endPicker.show = false
  autoSearch()
}
const result = reactive<SiteStatisticsResponse>({
  startDate: filters.startDate,
  endDate: filters.endDate,
  totalUploaded: 0,
  totalDownloaded: 0,
  siteCount: 0,
  allTimeUploaded: 0,
  allTimeDownloaded: 0,
  allTimeSiteCount: 0,
  total: 0,
  page: 1,
  pageSize: 20,
  siteOptions: [],
  items: []
})
const loading = ref(false)
const error = ref('')
const totalPages = computed(() => Math.max(Math.ceil(result.total / filters.pageSize), 1))

async function loadStatistics() {
  loading.value = true
  error.value = ''
  try {
    const data = await getSiteStatistics({
      startDate: filters.startDate,
      endDate: filters.endDate,
      siteId: filters.siteId || undefined,
      page: filters.page,
      pageSize: filters.pageSize
    })
    Object.assign(result, data)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '流量加载失败'
  } finally {
    loading.value = false
  }
}

function autoSearch() {
  filters.page = 1
  void loadStatistics()
}

function changePage(page: number) {
  filters.page = page
  void loadStatistics()
}

function formatBytes(value = 0) {
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`
}

function formatShare(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%'
}

const PIE_PALETTE = ['#3f7cff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f43f5e', '#a3a3a3']
const MAX_PIE_SLICES = 8

function buildPieSlices(key: 'uploaded' | 'downloaded'): PieSlice[] {
  const colorBySite = new Map<string, string>()
  result.siteOptions.forEach((opt, i) => {
    colorBySite.set(opt.siteId, PIE_PALETTE[i % PIE_PALETTE.length])
  })
  const total = result.items.reduce((sum, it) => sum + it[key], 0)
  if (total <= 0) return []
  const sorted = [...result.items].sort((a, b) => b[key] - a[key])
  const top = sorted.slice(0, MAX_PIE_SLICES)
  const rest = sorted.slice(MAX_PIE_SLICES)
  const restSum = rest.reduce((sum, it) => sum + it[key], 0)
  const slices: PieSlice[] = top.map((it) => ({
    name: it.siteName,
    value: it[key],
    color: colorBySite.get(it.siteId) ?? PIE_PALETTE[0],
    percent: (it[key] / total) * 100
  }))
  if (restSum > 0) {
    slices.push({
      name: `其他（${rest.length}）`,
      value: restSum,
      color: PIE_PALETTE[PIE_PALETTE.length - 1],
      percent: (restSum / total) * 100
    })
  }
  return slices
}

const uploadSlices = computed(() => buildPieSlices('uploaded'))
const downloadSlices = computed(() => buildPieSlices('downloaded'))

onMounted(loadStatistics)
</script>
