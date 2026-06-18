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
            <span class="chip" :class="downloaderStatusMeta(downloader.status).className">{{ downloaderStatusMeta(downloader.status).label }}</span>
            <span class="success">{{ formatBytes(downloader.uploadSpeed, '/s') }}</span>
            <span>{{ formatBytes(downloader.downloadSpeed, '/s') }}</span>
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
          <router-link to="/site-statistics">查看统计</router-link>
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
          </article>
        </div>
        <div v-else class="empty-tip">暂无最近任务记录。</div>
      </article>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { getDashboardOverview, type DashboardOverview } from '../api/dashboard'

const overview = ref<DashboardOverview>()
const loading = ref(false)
const error = ref('')
const lastUpdatedAt = ref('')

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

function jobStatusText(status: DashboardOverview['tasks']['recent'][number]['status']) {
  const map = {
    SUCCESS: '成功',
    FAILED: '失败',
    RUNNING: '运行中'
  }
  return map[status]
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

onMounted(loadOverview)
</script>
