<template>
  <AppLayout>
    <div class="dashboard-head">
      <div>
        <h1>首页概览</h1>
        <p>查看 PT 站点、种子、下载器和任务的整体运行状态</p>
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

    <section class="metric-grid">
      <article class="metric-card">
        <span>已配置站点</span>
        <strong>{{ overview?.sites.total ?? 0 }}</strong>
        <small>个站点</small>
      </article>
      <article class="metric-card">
        <span>今日种子</span>
        <strong>{{ overview?.torrents.todayNew ?? 0 }}</strong>
        <small>新增</small>
      </article>
      <article class="metric-card">
        <span>已推送下载器</span>
        <strong class="success">{{ overview?.torrents.pushed ?? 0 }}</strong>
        <small>任务</small>
      </article>
      <article class="metric-card">
        <span>即将过期</span>
        <strong class="warning">{{ overview?.torrents.expiringSoon ?? 0 }}</strong>
        <small>个种子</small>
      </article>
    </section>

    <section class="dashboard-grid">
      <article class="panel">
        <h2>传输状态</h2>
        <div class="transfer-grid">
          <div>
            <span>当前上传速度</span>
            <strong class="success">{{ formatBytes(overview?.transfer?.uploadSpeed, '/s') }}</strong>
          </div>
          <div>
            <span>当前下载速度</span>
            <strong>{{ formatBytes(overview?.transfer?.downloadSpeed, '/s') }}</strong>
          </div>
        </div>
        <div class="transfer-total">
          <div><span>总上传量</span><strong>{{ formatBytes(overview?.transfer?.uploadedTotal) }}</strong></div>
          <div><span>总下载量</span><strong>{{ formatBytes(overview?.transfer?.downloadedTotal) }}</strong></div>
        </div>
      </article>

      <article class="panel">
        <h2>站点健康状态</h2>
        <div class="health-bar">
          <span class="online" :style="{ width: healthWidth('online') }" />
          <span class="auth-failed" :style="{ width: healthWidth('authFailed') }" />
          <span class="offline" :style="{ width: healthWidth('offline') }" />
          <span class="unknown" :style="{ width: healthWidth('unknown') }" />
        </div>
        <div class="health-list">
          <span>在线 {{ overview?.sites.online ?? 0 }}</span>
          <span>认证失败 {{ overview?.sites.authFailed ?? 0 }}</span>
          <span>离线 {{ overview?.sites.offline ?? 0 }}</span>
          <span>未检测 {{ overview?.sites.unknown ?? 0 }}</span>
        </div>
        <div v-if="!overview?.sites.total" class="empty-tip">暂无站点，添加第一个站点后开始统计健康状态。</div>
      </article>
    </section>

    <section class="dashboard-grid lower">
      <article class="panel">
        <h2>风险提示</h2>
        <div v-if="overview?.risks.length" class="risk-list">
          <div v-for="risk in overview.risks" :key="risk.type" class="risk-item">
            <span>{{ risk.message }}</span>
            <router-link v-if="risk.actionPath" :to="risk.actionPath">{{ risk.actionText ?? '处理' }}</router-link>
          </div>
        </div>
        <div v-else class="empty-tip">暂无关键风险。</div>
      </article>

      <article class="panel">
        <h2>快捷操作</h2>
        <div class="quick-actions">
          <router-link v-for="action in overview?.quickActions ?? []" :key="action.text" :to="action.path">
            {{ action.text }}
          </router-link>
        </div>
      </article>
    </section>

    <section class="panel jobs-panel">
      <h2>最近任务</h2>
      <div v-if="overview?.recentJobs.length" class="job-list">
        <div v-for="job in overview.recentJobs" :key="job.name" class="job-row">
          <strong>{{ job.name }}</strong>
          <span>{{ job.status }}</span>
          <p>{{ job.summary }}</p>
          <time>{{ job.finishedAt }}</time>
        </div>
      </div>
      <div v-else class="empty-tip">暂无最近任务记录。</div>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { getDashboardOverview, type DashboardOverview } from '../api/dashboard'

const overview = ref<DashboardOverview>()
const loading = ref(false)
const error = ref('')
const lastUpdatedAt = ref('')

const totalSites = computed(() => overview.value?.sites.total || 0)

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

function healthWidth(key: keyof DashboardOverview['sites']) {
  if (!totalSites.value || key === 'total') return '0%'
  return `${Math.max(((overview.value?.sites[key] ?? 0) / totalSites.value) * 100, 0)}%`
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
