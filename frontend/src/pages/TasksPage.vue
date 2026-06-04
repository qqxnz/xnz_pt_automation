<template>
  <AppLayout>
    <section class="feature-page">
      <div class="dashboard-head">
        <div>
          <h1>任务</h1>
          <p>打开自动执行开关后开始计时；测试只核对抓取结果，运行会真实写入和推送。</p>
        </div>
        <button class="primary-button compact" type="button" @click="openCreate">新建任务</button>
      </div>

      <section class="site-stats">
        <article v-for="card in statCards" :key="card.label" class="metric-card">
          <span>{{ card.label }}</span>
          <strong :class="card.className">{{ card.value }}</strong>
        </article>
      </section>

      <section class="sites-toolbar panel">
        <input v-model.trim="filters.keyword" placeholder="搜索任务 / 站点 / 下载器" @keyup.enter="loadTasks" />
        <select v-model="filters.autoRun" @change="loadTasks">
          <option value="ALL">自动执行：全部</option>
          <option value="ON">已开启</option>
          <option value="OFF">已关闭</option>
        </select>
        <button class="secondary-button" type="button" :disabled="loading" @click="loadTasks">{{ loading ? '刷新中...' : '刷新' }}</button>
      </section>

      <section class="panel">
        <div class="panel-title-row">
          <h2>任务列表</h2>
          <span>{{ total }} 个任务</span>
        </div>
        <div v-if="error" class="error-banner">{{ error }}<button type="button" @click="loadTasks">重试</button></div>
        <div v-if="!items.length && !loading" class="sites-empty">
          <h2>还没有任务</h2>
          <p>先配置站点和下载器，然后创建第一个抓取推送任务。</p>
          <button class="primary-button compact" type="button" @click="openCreate">新建任务</button>
        </div>
        <div v-else class="desktop-table task-table">
          <div class="task-row table-head">
            <span>任务名称</span>
            <span>自动执行</span>
            <span>间隔</span>
            <span>下一次执行</span>
            <span>最近结果</span>
            <span>操作</span>
          </div>
          <div v-for="task in items" :key="task.id" class="task-row">
            <span>
              <strong>{{ task.name }}</strong>
              <small>{{ task.siteName }} · {{ task.downloaderName }} · {{ rangeText(task) }}</small>
            </span>
            <button class="switch" :class="{ on: task.autoRunEnabled }" type="button" :disabled="task.running" @click="toggleAutoRun(task)">
              <span></span>
            </button>
            <span>{{ task.intervalMinutes }} 分钟</span>
            <span>{{ formatDate(task.nextRunAt) }}</span>
            <span>
              <span class="chip" :class="task.lastStatus === 'FAILED' ? 'offline-chip' : task.lastStatus === 'SUCCESS' ? 'online-chip' : 'muted-chip'">{{ statusText(task.lastStatus) }}</span>
              <small>{{ task.lastSummary || '-' }}</small>
            </span>
            <span class="row-actions">
              <button type="button" :disabled="task.running" @click="testExistingTask(task)">测试</button>
              <button type="button" :disabled="task.running" @click="runExistingTask(task)">运行</button>
              <button type="button" @click="openEdit(task)">编辑</button>
              <router-link :to="{ path: '/logs', query: { type: 'task' } }">日志</router-link>
              <button class="danger-text" type="button" @click="removeTask(task)">删除</button>
            </span>
          </div>
        </div>
      </section>
    </section>

    <div v-if="formVisible" class="modal-backdrop">
      <form class="site-form task-form" @submit.prevent="saveTask">
        <div class="form-head">
          <div>
            <h2>{{ editingTaskId ? '编辑任务' : '新建任务' }}</h2>
            <p>测试不会记录，运行会写入种子和任务日志。</p>
          </div>
          <button type="button" @click="formVisible = false">×</button>
        </div>
        <div class="form-grid">
          <section>
            <h3>基础配置</h3>
            <label>任务名称<input v-model.trim="form.name" placeholder="例如 MTeam 免费自动推送" /></label>
            <label>站点<select v-model="form.siteId"><option value="">请选择站点</option><option v-for="site in sites" :key="site.id" :value="site.id">{{ site.displayName }}</option></select></label>
            <label>下载器<select v-model="form.downloaderId"><option value="">请选择下载器</option><option v-for="downloader in downloaders" :key="downloader.id" :value="downloader.id">{{ downloader.name }}</option></select></label>
            <label>执行间隔分钟<input v-model.number="form.intervalMinutes" min="30" type="number" /></label>
          </section>
          <section>
            <h3>运行规则</h3>
            <label class="inline-check"><input v-model="form.autoRunEnabled" type="checkbox" /> 自动执行开关</label>
            <label class="inline-check"><input v-model="form.freeOnly" type="checkbox" /> 只抓免费</label>
            <label class="inline-check"><input v-model="form.autoPush" type="checkbox" /> 自动推送到下载器</label>
            <div class="check-grid">
              <label v-for="type in discountOptions" :key="type.value" class="inline-check">
                <input v-model="form.discountTypes" type="checkbox" :value="type.value" /> {{ type.label }}
              </label>
            </div>
            <label>即将过期阈值<input v-model.number="form.expiringSoonMinutes" min="1" type="number" /></label>
          </section>
        </div>
        <div class="form-foot">
          <span>开启自动执行后，从保存时间开始计时。</span>
          <div class="row-actions">
            <button type="button" class="secondary-button" @click="formVisible = false">取消</button>
            <button type="submit" class="primary-button compact" :disabled="saving">{{ saving ? '保存中...' : '保存' }}</button>
          </div>
        </div>
      </form>
    </div>

    <div v-if="testResult" class="modal-backdrop">
      <section class="site-form test-result-dialog">
        <div class="form-head">
          <div>
            <h2>测试结果</h2>
            <p>{{ testResult.taskName }} · 抓取 {{ testResult.fetchedCount }} 个，命中 {{ testResult.matchedCount }} 个</p>
          </div>
          <button type="button" @click="testResult = undefined">×</button>
        </div>
        <div class="test-result-list">
          <article v-for="item in testResult.items" :key="item.torrentId">
            <strong>{{ item.title }}</strong>
            <span>{{ formatBytes(item.size) }} · {{ discountText(item.discountType) }}</span>
          </article>
          <div v-if="!testResult.items.length" class="empty-tip">没有命中当前任务规则的种子。</div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onMounted, reactive, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { getDownloaders, type DownloaderListItem } from '../api/downloaders'
import { getSites, type SiteListItem } from '../api/sites'
import {
  createTask,
  deleteTask,
  getTasks,
  runTask,
  testTask,
  updateTask,
  updateTaskAutoRun,
  type DiscountType,
  type TaskItem,
  type TaskPayload,
  type TaskStats,
  type TaskTestResult
} from '../api/tasks'

const items = ref<TaskItem[]>([])
const total = ref(0)
const stats = ref<TaskStats>({ total: 0, autoRunEnabled: 0, running: 0, failed: 0 })
const sites = ref<SiteListItem[]>([])
const downloaders = ref<DownloaderListItem[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const formVisible = ref(false)
const editingTaskId = ref<string>()
const testResult = ref<TaskTestResult>()

const filters = reactive({ keyword: '', autoRun: 'ALL' as 'ALL' | 'ON' | 'OFF' })
const form = reactive<TaskPayload>({
  name: '',
  siteId: '',
  downloaderId: '',
  autoRunEnabled: false,
  intervalMinutes: 30,
  freeOnly: true,
  autoPush: true,
  discountTypes: ['FREE', 'TWO_X_FREE', 'HALF_FREE'],
  expiringSoonMinutes: 120
})

const discountOptions: Array<{ value: DiscountType; label: string }> = [
  { value: 'FREE', label: 'FREE' },
  { value: 'TWO_X_FREE', label: '2X FREE' },
  { value: 'HALF_FREE', label: 'HALF FREE' }
]

const statCards = computed(() => [
  { label: '全部任务', value: stats.value.total, className: '' },
  { label: '自动执行', value: stats.value.autoRunEnabled, className: 'success' },
  { label: '运行中', value: stats.value.running, className: 'warning' },
  { label: '失败', value: stats.value.failed, className: 'danger' }
])

function resetForm() {
  editingTaskId.value = undefined
  Object.assign(form, {
    name: '',
    siteId: sites.value[0]?.id || '',
    downloaderId: downloaders.value[0]?.id || '',
    autoRunEnabled: false,
    intervalMinutes: 30,
    freeOnly: true,
    autoPush: true,
    discountTypes: ['FREE', 'TWO_X_FREE', 'HALF_FREE'],
    expiringSoonMinutes: 120,
    savePathOverride: undefined,
    categoryOverride: undefined,
    tagsOverride: undefined
  })
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

function openEdit(task: TaskItem) {
  editingTaskId.value = task.id
  Object.assign(form, {
    name: task.name,
    siteId: task.siteId,
    downloaderId: task.downloaderId,
    autoRunEnabled: task.autoRunEnabled,
    intervalMinutes: task.intervalMinutes,
    freeOnly: task.freeOnly,
    autoPush: task.autoPush,
    discountTypes: [...task.discountTypes],
    expiringSoonMinutes: task.expiringSoonMinutes ?? 120,
    savePathOverride: task.savePathOverride,
    categoryOverride: task.categoryOverride,
    tagsOverride: task.tagsOverride
  })
  formVisible.value = true
}

function validateForm() {
  if (!form.name.trim()) return '任务名称不能为空'
  if (!form.siteId) return '请选择站点'
  if (!form.downloaderId) return '请选择下载器'
  if (!Number.isInteger(form.intervalMinutes) || form.intervalMinutes < 30) return '执行间隔不能小于 30 分钟'
  if (!form.discountTypes.length) return '请至少选择一种免费类型'
  return ''
}

async function loadTasks() {
  loading.value = true
  error.value = ''
  try {
    const result = await getTasks(filters)
    items.value = result.items
    total.value = result.total
    stats.value = result.stats
  } catch (err) {
    error.value = err instanceof Error ? err.message : '任务列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadOptions() {
  const [siteResult, downloaderResult] = await Promise.all([
    getSites({ page: 1, pageSize: 100 }),
    getDownloaders({})
  ])
  sites.value = siteResult.items
  downloaders.value = downloaderResult.items
}

async function saveTask() {
  const validation = validateForm()
  if (validation) {
    Snackbar.warning(validation)
    return
  }
  saving.value = true
  try {
    if (editingTaskId.value) await updateTask(editingTaskId.value, form)
    else await createTask(form)
    Snackbar.success('任务已保存')
    formVisible.value = false
    await loadTasks()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleAutoRun(task: TaskItem) {
  try {
    await updateTaskAutoRun(task.id, !task.autoRunEnabled)
    Snackbar.success(!task.autoRunEnabled ? '自动执行已开启' : '自动执行已关闭')
    await loadTasks()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '操作失败')
  }
}

async function testExistingTask(task: TaskItem) {
  try {
    testResult.value = await testTask(task.id)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试失败')
  }
}

async function runExistingTask(task: TaskItem) {
  try {
    const result = await runTask(task.id)
    Snackbar.success(result.summary)
    await loadTasks()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '运行失败')
    await loadTasks()
  }
}

async function removeTask(task: TaskItem) {
  if (!window.confirm(`确认删除任务「${task.name}」？已抓取种子不会删除。`)) return
  await deleteTask(task.id)
  Snackbar.success('任务已删除')
  await loadTasks()
}

function formatBytes(value?: number) {
  if (value === undefined) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unitIndex ? 2 : 0 }).format(size)} ${units[unitIndex]}`
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'
}

function discountText(value: string) {
  return value === 'TWO_X_FREE' ? '2X FREE' : value === 'HALF_FREE' ? 'HALF FREE' : value
}

function rangeText(task: TaskItem) {
  return task.freeOnly ? task.discountTypes.map(discountText).join(', ') : '全部种子'
}

function statusText(status?: TaskItem['lastStatus']) {
  if (status === 'SUCCESS') return '成功'
  if (status === 'FAILED') return '失败'
  return '未运行'
}

onMounted(async () => {
  await loadOptions()
  await loadTasks()
})
</script>
