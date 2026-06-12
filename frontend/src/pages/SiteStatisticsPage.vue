<template>
  <AppLayout>
    <section class="feature-page statistics-page">
      <div class="dashboard-head">
        <div>
          <h1>流量</h1>
          <p>按来源站点和日期统计 qBittorrent 种子的实际上传、下载增量。</p>
        </div>
      </div>

      <section class="site-stats">
        <article class="metric-card"><span>区间上传</span><strong class="success">{{ formatBytes(result.totalUploaded) }}</strong></article>
        <article class="metric-card"><span>区间下载</span><strong>{{ formatBytes(result.totalDownloaded) }}</strong></article>
        <article class="metric-card"><span>涉及站点</span><strong>{{ result.siteCount }}</strong></article>
        <article class="metric-card"><span>统计区间</span><strong class="statistics-date-value">{{ filters.startDate }} 至 {{ filters.endDate }}</strong></article>
      </section>

      <section class="sites-toolbar statistics-toolbar panel">
        <label><span>开始日期</span><input v-model="filters.startDate" type="date" /></label>
        <label><span>结束日期</span><input v-model="filters.endDate" type="date" /></label>
        <label>
          <span>站点</span>
          <select v-model="filters.siteId">
            <option value="">全部站点</option>
            <option v-for="site in result.siteOptions" :key="site.siteId" :value="site.siteId">
              {{ site.siteName }}{{ site.siteDeleted ? '（已删除）' : '' }}
            </option>
          </select>
        </label>
        <button class="secondary-button" type="button" :disabled="loading" @click="search">
          {{ loading ? '查询中...' : '查询' }}
        </button>
      </section>

      <section class="panel statistics-chart-panel">
        <div class="panel-title-row">
          <h2>流量趋势</h2>
          <div class="statistics-granularity" role="tablist" aria-label="流量粒度">
            <button
              v-for="option in granularityOptions"
              :key="option.value"
              type="button"
              role="tab"
              :aria-selected="filters.granularity === option.value"
              :class="{ active: filters.granularity === option.value }"
              :disabled="loading"
              @click="setGranularity(option.value)"
            >{{ option.label }}</button>
          </div>
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
              <span><small>上传</small><strong class="success">{{ formatBytes(site.uploaded) }}</strong></span>
              <span><small>下载</small><strong>{{ formatBytes(site.downloaded) }}</strong></span>
              <span><small>流量占比</small><strong>{{ formatShare(site.uploaded + site.downloaded) }}</strong></span>
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

type Granularity = 'day' | 'week' | 'month'

const granularityOptions: Array<{ value: Granularity; label: string }> = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' }
]

function dateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseDateKey(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

function isoWeekKey(value: Date) {
  const target = new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const dayOfWeek = (target.getDay() + 6) % 7
  target.setDate(target.getDate() - dayOfWeek)
  const startKey = dateKey(target)
  const end = new Date(target)
  end.setDate(end.getDate() + 6)
  const endKey = dateKey(end)
  return { key: startKey, label: `${startKey.slice(5)} ~ ${endKey.slice(5)}` }
}

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}

const MAX_BUCKETS = 180

const today = new Date()
const start = new Date(today)
start.setDate(start.getDate() - 29)
const filters = reactive({
  startDate: dateKey(start),
  endDate: dateKey(today),
  siteId: '',
  page: 1,
  pageSize: 20,
  granularity: 'day' as Granularity
})
const result = reactive<SiteStatisticsResponse>({
  startDate: filters.startDate,
  endDate: filters.endDate,
  totalUploaded: 0,
  totalDownloaded: 0,
  siteCount: 0,
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
    Object.assign(result, await getSiteStatistics(filters))
  } catch (err) {
    error.value = err instanceof Error ? err.message : '流量加载失败'
  } finally {
    loading.value = false
  }
}

function search() {
  filters.page = 1
  void loadStatistics()
}

function changePage(page: number) {
  filters.page = page
  void loadStatistics()
}

function setGranularity(value: Granularity) {
  if (filters.granularity === value) return
  filters.granularity = value
}

function formatBytes(value = 0) {
  if (value === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`
}

function formatShare(value: number) {
  const total = result.totalUploaded + result.totalDownloaded
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0%'
}

type BucketAccumulator = { label: string; uploaded: number; downloaded: number }

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
