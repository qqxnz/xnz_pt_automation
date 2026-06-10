<template>
  <AppLayout>
    <div class="dashboard-head">
      <div>
        <h1>日志</h1>
        <p>查看系统操作记录和任务运行记录。</p>
      </div>
      <div class="head-actions">
        <span v-if="lastUpdatedAt">最近更新：{{ lastUpdatedAt }}</span>
        <button class="secondary-button compact" type="button" :disabled="loading || exporting" @click="downloadLogs">
          {{ exporting ? '导出中...' : '导出' }}
        </button>
        <button class="secondary-button compact danger-button" type="button" :disabled="loading || clearing || total === 0" @click="clearCurrentLogs">
          {{ clearing ? '清空中...' : '清空' }}
        </button>
        <button class="primary-button compact" type="button" :disabled="loading" @click="loadLogs">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="error-banner">
      {{ error }}
      <button type="button" @click="loadLogs">重试</button>
    </div>

    <section class="panel logs-panel">
      <div class="logs-toolbar">
        <div class="tabs">
          <button type="button" :class="{ active: activeType === 'operation' }" @click="switchType('operation')">
            操作日志
          </button>
          <button type="button" :class="{ active: activeType === 'task' }" @click="switchType('task')">
            任务日志
          </button>
          <button type="button" :class="{ active: activeType === 'schedule' }" @click="switchType('schedule')">
            定时日志
          </button>
        </div>
        <span>{{ total }} 条记录</span>
      </div>

      <div v-if="items.length" class="log-list">
        <article v-for="item in items" :key="item.id" class="log-row">
          <div class="log-meta">
            <time>{{ formatTime(item.createdAt) }}</time>
            <span class="status-badge" :class="item.status.toLowerCase()">{{ statusText(item.status) }}</span>
          </div>
          <div>
            <strong>{{ primaryText(item) }}</strong>
            <p>{{ item.message }}</p>
            <div v-if="failureDetails(item).length" class="log-details">
              <span v-for="detail in failureDetails(item)" :key="detail">{{ detail }}</span>
            </div>
            <small>{{ secondaryText(item) }}</small>
          </div>
        </article>
      </div>
      <div v-else class="empty-tip">
        {{ emptyText }}
      </div>

      <div class="pager">
        <button type="button" :disabled="page <= 1 || loading" @click="changePage(page - 1)">上一页</button>
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <button type="button" :disabled="page >= totalPages || loading" @click="changePage(page + 1)">下一页</button>
      </div>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import { clearLogs, exportLogs, getLogs, type LogType, type OperationLog, type ScheduleLog, type TaskLog } from '../api/logs'

const route = useRoute()
const activeType = ref<LogType>(route.query.type === 'task' ? 'task' : route.query.type === 'schedule' ? 'schedule' : 'operation')
const operationLogs = ref<OperationLog[]>([])
const taskLogs = ref<TaskLog[]>([])
const scheduleLogs = ref<ScheduleLog[]>([])
const loading = ref(false)
const exporting = ref(false)
const clearing = ref(false)
const error = ref('')
const lastUpdatedAt = ref('')
const page = ref(1)
const pageSize = 20
const total = ref(0)

const items = computed(() => (activeType.value === 'operation' ? operationLogs.value : activeType.value === 'schedule' ? scheduleLogs.value : taskLogs.value))
const totalPages = computed(() => Math.max(Math.ceil(total.value / pageSize), 1))
const activeTypeText = computed(() => (activeType.value === 'operation' ? '操作日志' : activeType.value === 'schedule' ? '定时日志' : '任务日志'))
const emptyText = computed(() => `暂无${activeTypeText.value}。`)

function switchType(type: LogType) {
  if (activeType.value === type) {
    return
  }
  activeType.value = type
  page.value = 1
  loadLogs()
}

function changePage(nextPage: number) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value)
  loadLogs()
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN')
}

function statusText(status: OperationLog['status'] | TaskLog['status'] | ScheduleLog['status']) {
  const map = {
    SUCCESS: '成功',
    FAILED: '失败',
    RUNNING: '运行中'
  }
  return map[status]
}

function primaryText(item: OperationLog | TaskLog | ScheduleLog) {
  if (item.type === 'OPERATION') return item.action
  if (item.type === 'SCHEDULE') return scheduleJobText(item.jobName)
  return item.taskName
}

function secondaryText(item: OperationLog | TaskLog | ScheduleLog) {
  if (item.type === 'TASK') {
    return [
      item.taskId ? `任务 ID：${item.taskId}` : '系统任务',
      item.runMode ? `来源：${runModeText(item.runMode)}` : '',
      item.startedAt ? `开始：${formatTime(item.startedAt)}` : '',
      item.finishedAt ? `结束：${formatTime(item.finishedAt)}` : '',
      taskResultText(item)
    ]
      .filter(Boolean)
      .join(' / ')
  }
  if (item.type === 'SCHEDULE') {
    return [
      item.startedAt ? `开始：${formatTime(item.startedAt)}` : '',
      item.finishedAt ? `结束：${formatTime(item.finishedAt)}` : '',
      item.durationMs === undefined ? '' : `耗时：${item.durationMs}ms`,
      item.summary ? `摘要：${item.summary}` : '',
      item.errorMessage ? `错误：${item.errorMessage}` : ''
    ]
      .filter(Boolean)
      .join(' / ')
  }
  return [item.actorName ? `操作者：${item.actorName}` : '操作者：未知', item.ip ? `IP：${item.ip}` : ''].filter(Boolean).join(' / ')
}

function scheduleJobText(jobName: string) {
  const map: Record<string, string> = {
    'task-auto-run-scan': '自动任务扫描',
    'task-auto-run': '自动任务执行',
    'torrent-download-stats-sync': '种子下载器状态同步',
    'expired-free-download-cleanup': '仅免费下载过期清理',
    'site-traffic-sync': '站点流量统计同步'
  }
  return map[jobName] ?? jobName
}

function runModeText(mode: NonNullable<TaskLog['runMode']>) {
  const map = {
    AUTO: '自动执行',
    MANUAL_RUN: '手动运行'
  }
  return map[mode]
}

function taskResultText(item: TaskLog) {
  const parts = [
    item.fetchedCount === undefined ? '' : `抓取：${item.fetchedCount}`,
    item.skippedExistingCount === undefined ? '' : `去重：${item.skippedExistingCount}`,
    item.matchedCount === undefined ? '' : `命中：${item.matchedCount}`,
    item.pushedCount === undefined ? '' : `推送成功：${item.pushedCount}`,
    item.pushFailedCount === undefined ? '' : `推送失败：${item.pushFailedCount}`
  ].filter(Boolean)
  return parts.join('，')
}

function failureDetails(item: OperationLog | TaskLog | ScheduleLog) {
  if (item.type === 'SCHEDULE') {
    return item.details ? [JSON.stringify(item.details)] : []
  }
  if (item.type !== 'TASK') return []
  const details = [...(item.failureDetails ?? []), item.fetchErrorMessage ? `抓取失败：${item.fetchErrorMessage}` : '', ...(item.pushErrorMessages ?? [])].filter(Boolean)
  return [...new Set(details)].slice(0, 4)
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function downloadLogs() {
  exporting.value = true
  error.value = ''
  try {
    const result = await exportLogs(activeType.value)
    saveBlob(result.blob, result.filename)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '日志导出失败'
  } finally {
    exporting.value = false
  }
}

async function clearCurrentLogs() {
  if (!window.confirm(`确认清空当前 ${activeTypeText.value}？此操作不可恢复。`)) return
  clearing.value = true
  error.value = ''
  try {
    await clearLogs(activeType.value)
    page.value = 1
    await loadLogs()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '日志清空失败'
  } finally {
    clearing.value = false
  }
}

async function loadLogs() {
  loading.value = true
  error.value = ''
  try {
    if (activeType.value === 'operation') {
      const result = await getLogs('operation', page.value, pageSize)
      operationLogs.value = result.items
      total.value = result.total
    } else if (activeType.value === 'schedule') {
      const result = await getLogs('schedule', page.value, pageSize)
      scheduleLogs.value = result.items
      total.value = result.total
    } else {
      const result = await getLogs('task', page.value, pageSize)
      taskLogs.value = result.items
      total.value = result.total
    }
    lastUpdatedAt.value = new Date().toLocaleString('zh-CN')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '日志加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadLogs)
</script>
