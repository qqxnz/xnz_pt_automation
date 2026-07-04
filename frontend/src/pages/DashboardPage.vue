<template>
  <AppLayout>
    <div class="dashboard-head">
      <div>
        <h1>首页概览</h1>
        <p>按站点、下载器、任务、种子和流量查看运行状态</p>
      </div>
      <div class="head-actions">
        <span v-if="lastUpdatedAt">最近更新：{{ lastUpdatedAt }}</span>
        <button class="primary-button compact" type="button" :disabled="loading" @click="loadOverview">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      {{ error }}
      <button type="button" @click="loadOverview">重试</button>
    </div>

    <section class="dashboard-sections">
      <article class="panel dashboard-section-card">
        <div class="panel-title-row">
          <h2>站点</h2>
          <router-link to="/sites">查看站点</router-link>
        </div>
        <div class="dashboard-stat-grid">
          <div><span>已配置站点</span><strong>{{ overview?.sites.total ?? 0 }}</strong></div>
          <div><span>在线</span><strong class="success">{{ overview?.sites.online ?? 0 }}</strong></div>
          <div><span>认证失败</span><strong class="warning">{{ overview?.sites.authFailed ?? 0 }}</strong></div>
          <div><span>离线</span><strong class="danger">{{ overview?.sites.offline ?? 0 }}</strong></div>
        </div>
        <div class="dashboard-stat-grid compact">
          <div><span>开启签到</span><strong>{{ overview?.sites.signinEnabled ?? 0 }}</strong></div>
          <div><span>今日已签到</span><strong class="success">{{ overview?.sites.todaySigninSuccess ?? 0 }}</strong></div>
          <div><span>今日签到失败</span><strong class="danger">{{ overview?.sites.todaySigninFailed ?? 0 }}</strong></div>
          <div><span>今日待签到</span><strong class="warning">{{ overview?.sites.todaySigninPending ?? 0 }}</strong></div>
        </div>
      </article>

      <article class="panel dashboard-section-card">
        <div class="panel-title-row">
          <h2>下载器</h2>
          <router-link to="/downloaders">查看下载器</router-link>
        </div>
        <div v-if="overview?.downloaders.items.length" class="dashboard-table downloader-overview-table">
          <div class="dashboard-table-row table-head"><span>名称</span><span>类型</span><span>状态</span><span>上传速度</span><span>下载速度</span></div>
          <div v-for="downloader in overview.downloaders.items" :key="downloader.id" class="dashboard-table-row">
            <strong>{{ downloader.name }}</strong>
            <span>{{ downloaderTypeText(downloader.type) }}</span>
            <span class="chip" :class="downloaderStatusMeta(displayStatus(downloader)).className">{{ downloaderStatusMeta(displayStatus(downloader)).label }}</span>
            <span class="success">{{ formatBytes(statusById[downloader.id]?.uploadSpeed, '/s') }}</span>
            <span>{{ formatBytes(statusById[downloader.id]?.downloadSpeed, '/s') }}</span>
          </div>
        </div>
        <div v-else class="empty-tip">暂无下载器。</div>
      </article>

      <article class="panel dashboard-section-card">
        <div class="panel-title-row">
          <h2>种子</h2>
          <router-link to="/torrents">查看种子</router-link>
        </div>
        <div class="dashboard-stat-grid">
          <div><span>种子数量</span><strong>{{ overview?.torrents.total ?? 0 }}</strong></div>
          <div><span>运行中</span><strong class="success">{{ overview?.torrents.running ?? 0 }}</strong></div>
          <div><span>未运行</span><strong class="warning">{{ overview?.torrents.notRunning ?? 0 }}</strong></div>
          <div><span>总上传</span><strong>{{ formatBytes(overview?.torrents.totalUploaded) }}</strong></div>
          <div><span>总下载</span><strong>{{ formatBytes(overview?.torrents.totalDownloaded) }}</strong></div>
        </div>
      </article>

      <article class="panel dashboard-section-card">
        <div class="panel-title-row">
          <h2>流量</h2>
          <router-link to="/statistics">查看统计</router-link>
        </div>
        <div class="dashboard-stat-grid">
          <div><span>总上传</span><strong class="success">{{ formatBytes(overview?.traffic.uploadedTotal) }}</strong></div>
          <div><span>总下载</span><strong>{{ formatBytes(overview?.traffic.downloadedTotal) }}</strong></div>
          <div><span>今日上传</span><strong class="success">{{ formatBytes(overview?.traffic.todayUploaded) }}</strong></div>
          <div><span>今日下载</span><strong>{{ formatBytes(overview?.traffic.todayDownloaded) }}</strong></div>
        </div>
      </article>

      <article class="panel dashboard-section-card wide">
        <div class="panel-title-row">
          <h2>任务</h2>
          <router-link to="/tasks">查看任务</router-link>
        </div>
        <div class="dashboard-stat-grid">
          <div><span>任务数量</span><strong>{{ overview?.tasks.total ?? 0 }}</strong></div>
          <div><span>自动执行</span><strong class="success">{{ overview?.tasks.autoRunEnabled ?? 0 }}</strong></div>
          <div><span>运行中</span><strong>{{ overview?.tasks.running ?? 0 }}</strong></div>
          <div><span>失败</span><strong class="danger">{{ overview?.tasks.failed ?? 0 }}</strong></div>
        </div>
        <div v-if="overview?.tasks.recent.length" class="dashboard-job-list">
          <article v-for="job in overview.tasks.recent" :key="job.id ?? `${job.name}-${job.finishedAt ?? ''}`" class="dashboard-job-row">
            <div>
              <strong>{{ job.name }}</strong>
              <small>{{ job.summary }}</small>
            </div>
            <span class="status-badge" :class="job.status.toLowerCase()">{{ jobStatusText(job.status) }}</span>
            <time>{{ formatTime(job.createdAt) }}</time>
          </article>
        </div>
        <div v-else class="empty-tip">暂无最近任务记录。</div>
      </article>

      <article class="panel dashboard-section-card wide">
        <div class="panel-title-row">
          <h2>后台任务</h2>
          <span>{{ overview?.scheduler.jobs.length ?? 0 }} 个任务</span>
        </div>
        <div class="dashboard-table scheduler-overview-table">
          <div class="dashboard-table-row table-head">
            <span>任务名称</span><span>间隔</span><span>状态</span><span>上次执行</span><span>下次运行</span>
          </div>
          <div v-for="job in overview?.scheduler.jobs" :key="job.name" class="dashboard-table-row">
            <strong>{{ job.readableName }}</strong>
            <span>{{ formatInterval(job.intervalMs) }}</span>
            <span class="status-badge" :class="schedulerStatusClass(job)">{{ schedulerStatusText(job) }}</span>
            <span>{{ formatTime(job.lastRunAt) }}</span>
            <span>{{ formatTime(job.nextRunAt) }}</span>
          </div>
        </div>
      </article>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { getDashboardOverview, type DashboardOverview, type SchedulerJobStatus } from '../api/dashboard'
import { getDownloaderStatus, type DownloaderStatus } from '../api/downloaders'

const overview = ref<DashboardOverview>()
const loading = ref(false)
const error = ref('')
const lastUpdatedAt = ref('')
const statusById = ref<Record<string, DownloaderStatus | undefined>>({})
let statusTimer: number | undefined

function formatBytes(value?: number, suffix = '') {
  if (value === undefined || value === null) return '--'
  if (value <= 0) return `0 B${suffix}`
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}${suffix}`
}

function downloaderTypeText(type: DashboardOverview['downloaders']['items'][number]['type']) {
  return type === 'QBITTORRENT' ? 'qBittorrent' : type
}

function downloaderStatusMeta(status: DashboardOverview['downloaders']['items'][number]['status']) {
  const map = {
    ONLINE: { label: '在线', className: 'online-chip' },
    OFFLINE: { label: '离线', className: 'offline-chip' },
    AUTH_FAILED: { label: '认证失败', className: 'auth-chip' },
    UNKNOWN: { label: '未检测', className: 'unknown-chip' }
  }
  return map[status]
}

function displayStatus(downloader: DashboardOverview['downloaders']['items'][number]) {
  return statusById.value[downloader.id]?.status ?? downloader.status
}

function jobStatusText(status: DashboardOverview['tasks']['recent'][number]['status']) {
  const map = {
    SUCCESS: '成功',
    FAILED: '失败',
    RUNNING: '运行中'
  }
  return map[status]
}

function schedulerStatusClass(job: SchedulerJobStatus) {
  if (job.running) return 'running'
  if (job.lastStatus === 'FAILED') return 'failed'
  if (job.lastStatus === 'SUCCESS') return 'success'
  return ''
}

function schedulerStatusText(job: SchedulerJobStatus) {
  if (job.running) return '运行中'
  if (job.lastStatus === 'FAILED') return '失败'
  if (job.lastStatus === 'SUCCESS') return '空闲'
  return '等待中'
}

function formatInterval(ms: number) {
  if (ms >= 86400000) return `${Math.floor(ms / 86400000)} 天`
  if (ms >= 3600000) return `${Math.floor(ms / 3600000)} 小时`
  if (ms >= 60000) return `${Math.floor(ms / 60000)} 分钟`
  return `${Math.floor(ms / 1000)} 秒`
}

function formatTime(value?: string) {
  if (!value) return '-'
  const diff = Date.now() - new Date(value).getTime()
  const abs = Math.abs(diff)
  const sign = diff < 0 ? '后' : '前'

  const days = Math.floor(abs / 86400000)
  const hours = Math.floor((abs % 86400000) / 3600000)
  const minutes = Math.floor((abs % 3600000) / 60000)
  const seconds = Math.floor((abs % 60000) / 1000)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (minutes > 0) parts.push(`${minutes}分钟`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`)

  return parts.join('') + sign
}

async function loadOverview() {
  loading.value = true
  error.value = ''
  try {
    overview.value = await getDashboardOverview()
    lastUpdatedAt.value = new Date().toLocaleString('zh-CN')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '首页数据加载失败'
  } finally {
    loading.value = false
  }
}

async function refreshDownloaderStatus(downloader: DashboardOverview['downloaders']['items'][number]) {
  if (document.hidden) return
  try {
    const status = await getDownloaderStatus(downloader.id, true)
    statusById.value = { ...statusById.value, [downloader.id]: status }
  } catch {
    // skipWrite 轮询静默忽略错误
  }
}

async function refreshAllStatuses() {
  if (!overview.value?.downloaders.items.length) return
  for (const downloader of overview.value.downloaders.items) {
    await refreshDownloaderStatus(downloader)
  }
}

function stopStatusPolling() {
  if (statusTimer !== undefined) window.clearInterval(statusTimer)
  statusTimer = undefined
}

function startStatusPolling() {
  stopStatusPolling()
  if (!overview.value?.downloaders.items.length) return
  statusTimer = window.setInterval(refreshAllStatuses, 1000)
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopStatusPolling()
  } else {
    refreshAllStatuses()
    startStatusPolling()
  }
}

onMounted(async () => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  await loadOverview()
  await refreshAllStatuses()
  startStatusPolling()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopStatusPolling()
})
</script>
