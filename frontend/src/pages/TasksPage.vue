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
        <select v-if="isDesktop" v-model="filters.autoRun" @change="loadTasks" aria-label="按自动执行状态过滤">
          <option value="ALL">自动执行：全部</option>
          <option value="ON">已开启</option>
          <option value="OFF">已关闭</option>
        </select>
        <SegmentedButtons
          v-else
          class="toolbar-filter-segmented"
          v-model="filters.autoRun"
          :options="autoRunFilterOptions"
          size="small"
          @change="loadTasks"
        />
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
              <span class="chip" :class="statusClass(task)">{{ statusText(task) }}</span>
              <small>{{ task.lastSummary || '-' }}</small>
            </span>
            <span class="row-actions">
              <button type="button" :disabled="task.running || testingTaskId === task.id" @click="testExistingTask(task)">{{ testingTaskId === task.id ? '测试中...' : '测试' }}</button>
              <button type="button" :disabled="task.running" @click="runExistingTask(task)">{{ task.running ? '运行中...' : '运行' }}</button>
              <button type="button" @click="openEdit(task)">编辑</button>
              <router-link :to="{ path: '/logs', query: { type: 'task' } }">日志</router-link>
              <button class="danger-text" type="button" @click="removeTask(task)">删除</button>
            </span>
          </div>
        </div>

        <div class="mobile-task-list">
          <article v-for="task in items" :key="task.id" class="site-card task-card">
            <div>
              <strong>{{ task.name }}</strong>
              <span class="chip" :class="statusClass(task)">{{ statusText(task) }}</span>
            </div>
            <p>{{ task.siteName }} · {{ task.downloaderName }}</p>
            <dl class="site-stat-grid">
              <div>
                <dt>自动执行</dt>
                <dd>{{ task.autoRunEnabled ? '已开启' : '已关闭' }}</dd>
              </div>
              <div>
                <dt>间隔</dt>
                <dd>{{ task.intervalMinutes }} 分钟</dd>
              </div>
              <div>
                <dt>下一次执行</dt>
                <dd>{{ formatDate(task.nextRunAt) }}</dd>
              </div>
              <div>
                <dt>规则</dt>
                <dd>{{ rangeText(task) }}</dd>
              </div>
            </dl>
            <p>最近结果：{{ task.lastSummary || '-' }}</p>
            <div class="mobile-task-toggle">
              <span>自动执行</span>
              <button class="switch" :class="{ on: task.autoRunEnabled }" type="button" :disabled="task.running" @click="toggleAutoRun(task)">
                <span></span>
              </button>
            </div>
            <div class="row-actions">
              <button type="button" :disabled="task.running || testingTaskId === task.id" @click="testExistingTask(task)">{{ testingTaskId === task.id ? '测试中...' : '测试' }}</button>
              <button type="button" :disabled="task.running" @click="runExistingTask(task)">{{ task.running ? '运行中...' : '运行' }}</button>
              <button type="button" @click="openEdit(task)">编辑</button>
              <router-link :to="{ path: '/logs', query: { type: 'task' } }">日志</router-link>
              <button class="danger-text" type="button" @click="removeTask(task)">删除</button>
            </div>
          </article>
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
        <div class="task-form-sections">
          <section class="form-section">
            <h3>基础配置</h3>
            <div class="form-grid two-col">
              <label>任务名称<input v-model.trim="form.name" placeholder="例如 MTeam 免费自动推送" /></label>
              <label>执行间隔（分钟）<input v-model.number="form.intervalMinutes" min="10" type="number" /></label>
              <label>站点
                <AppSelect
                  v-model="form.siteId"
                  placeholder="请选择站点"
                  :options="siteOptions"
                  :rules="[(v) => !!v || '请选择站点']"
                />
              </label>
              <label>下载器
                <AppSelect
                  v-model="form.downloaderId"
                  placeholder="请选择下载器"
                  :options="downloaderOptions"
                  :rules="[(v) => !!v || '请选择下载器']"
                />
              </label>
            </div>
            <div class="check-grid">
              <label class="inline-check"><input v-model="form.autoRunEnabled" type="checkbox" /> 启用自动执行</label>
              <label class="inline-check"><input v-model="form.autoPush" type="checkbox" /> 自动推送到下载器</label>
            </div>
            <label>默认保存路径<input v-model.trim="form.savePathOverride" placeholder="不填则使用下载器 QB/TR 默认路径" /></label>
          </section>

          <section class="form-section">
            <h3>抓取规则</h3>
            <div class="form-grid two-col">
              <label class="full">排序规则
                <AppSelect
                  v-model="form.sortRule"
                  placeholder="不排序（按抓取顺序）"
                  :options="sortRuleSelectOptions"
                  clearable
                />
              </label>
              <label>入库数量
                <input v-model.number="form.torrentCount" min="0" step="1" type="number" placeholder="0 表示不限制" />
              </label>
            </div>
            <fieldset class="rule-group">
              <legend>优惠类型（任选其一命中即可）</legend>
              <div class="check-grid">
                <label v-for="type in discountOptions" :key="type.value" class="inline-check">
                  <input v-model="form.discountTypes" type="checkbox" :value="type.value" /> {{ type.label }}
                </label>
              </div>
            </fieldset>
            <fieldset class="rule-group">
              <legend>种子体积（GB，0 表示不限制）</legend>
              <div class="form-grid two-col">
                <label>最小体积<input v-model.number="form.sizeMinGb" min="0" step="1" type="number" /></label>
                <label>最大体积<input v-model.number="form.sizeMaxGb" min="0" step="1" type="number" /></label>
              </div>
            </fieldset>
            <fieldset class="rule-group">
              <legend>做种人数（不设置则不限）</legend>
              <div class="form-grid two-col">
                <label>条件
                  <AppSelect
                    v-model="form.seederCondition"
                    placeholder="不限制"
                    :options="seederConditionOptions"
                    clearable
                  />
                </label>
                <label>阈值<input v-model.number="form.seederCount" min="0" type="number" :disabled="!form.seederCondition" /></label>
              </div>
            </fieldset>
          </section>

          <section class="form-section">
            <h3>
              删除规则
              <button class="hint-button" type="button" aria-label="删除条件说明" @click="showOnlyFreeDownloadHint = !showOnlyFreeDownloadHint">?</button>
            </h3>
            <p v-if="showOnlyFreeDownloadHint" class="inline-hint">满足任一条件就会自动删除该种子在下载器中的任务并删除已下载的文件。</p>
            <fieldset class="rule-group">
              <legend>下载器删除条件（任一命中即删除任务+文件）</legend>
              <label class="inline-check"><input v-model="form.onlyFreeDownload" type="checkbox" /> 仅免费下载（已过免费期且未下载完成）</label>
              <label class="inline-check"><input v-model="form.deleteOnFreeExpire" type="checkbox" /> 免费到期（无视下载进度）</label>
              <div class="inline-row">
                <span>上传速度低于</span>
                <input v-model.number="form.lowUploadKbps" type="number" min="0" step="1" placeholder="0 表示不启用" />
                <span>KB/秒，持续</span>
                <input v-model.number="form.lowUploadMinutes" type="number" min="0" step="1" placeholder="0 表示不启用" />
                <span>分钟</span>
              </div>
            </fieldset>
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
            <p class="test-summary-title">{{ testResult.taskName }} · {{ testResult.siteName }}</p>
            <p class="test-summary-stats">
              <span class="stat">抓取 {{ testResult.fetchedCount }} 个</span>
              <span v-if="(testResult.skippedExistingCount ?? 0) > 0" class="stat">去重 {{ testResult.skippedExistingCount }} 个</span>
              <span class="stat">命中 {{ testResult.matchedCount }} 个</span>
              <span class="stat stat-pushable">待入库 {{ testResult.pushableCount }} 个</span>
            </p>
          </div>
          <button type="button" @click="testResult = undefined">×</button>
        </div>
        <div class="test-result-list">
          <article v-for="item in testResult.items" :key="item.torrentId" :class="{ 'is-matched': item.matched, 'is-pushable': item.pushable, 'is-skipped': item.skippedExisting }">
            <strong>
              <span v-if="item.skippedExisting" class="match-badge badge-skipped">去重</span>
              <span v-if="item.matched" class="match-badge badge-matched">命中</span>
              <span v-if="item.pushable" class="match-badge badge-pushable">待入库</span>
              {{ item.title }}
            </strong>
            <span>{{ formatBytes(item.size) }} · {{ discountText(item.discountType) }} · {{ freeEndText(item) }} · 做种 {{ item.seeders ?? 0 }}</span>
          </article>
          <div v-if="testResult.fetchedCount === 0" class="empty-tip">未抓到任何种子，无法匹配。</div>
          <div v-else-if="testResult.pushableCount === 0" class="empty-tip">没有命中当前任务规则的种子。</div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { SegmentedButtons } from '@varlet/ui'
import AppSelect from '../components/AppSelect.vue'
import { useMediaQuery } from '../composables/useMediaQuery'
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
  type SeederCondition,
  type TaskItem,
  type TaskPayload,
  type TaskSortRule,
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
const testingTaskId = ref<string>()
const showOnlyFreeDownloadHint = ref(false)

const filters = reactive({ keyword: '', autoRun: 'ALL' as 'ALL' | 'ON' | 'OFF' })
const form = reactive<TaskPayload & { torrentCount: number; lowUploadKbps: number; lowUploadMinutes: number; sortRule: TaskSortRule | '' }>({
  name: '',
  siteId: '',
  downloaderId: '',
  autoRunEnabled: false,
  intervalMinutes: 30,
  onlyFreeDownload: true,
  deleteOnFreeExpire: false,
  lowUploadKbps: 0,
  lowUploadMinutes: 0,
  autoPush: true,
  discountTypes: ['FREE', 'TWO_X_FREE'],
  seederCondition: '',
  seederCount: 0,
  sizeMinGb: 0,
  sizeMaxGb: 0,
  torrentCountCondition: '',
  torrentCount: 0,
  sortRule: '',
  savePathOverride: ''
})

const discountOptions: Array<{ value: DiscountType; label: string }> = [
  { value: 'FREE', label: 'FREE' },
  { value: 'TWO_X_FREE', label: '2X FREE' },
  { value: 'HALF_FREE', label: '50% FREE' },
  { value: 'NORMAL', label: '不免费' }
]

const seederConditionText: Record<SeederCondition, string> = {
  GT: '大于',
  EQ: '等于',
  LT: '小于'
}

const sortRuleOptions: Array<{ value: TaskSortRule; label: string }> = [
  { value: 'SEEDERS_ASC', label: '做种人数最少在前' },
  { value: 'SEEDERS_DESC', label: '做种人数最多在前' },
  { value: 'CREATED_DESC', label: '发布时间最新在前' },
  { value: 'CREATED_ASC', label: '发布时间最久在前' },
  { value: 'SIZE_DESC', label: '种子体积最大在前' },
  { value: 'SIZE_ASC', label: '种子体积最小在前' }
]

// 工具栏过滤器段控件选项
const autoRunFilterOptions = [
  { label: '全部', value: 'ALL' },
  { label: '已开启', value: 'ON' },
  { label: '已关闭', value: 'OFF' }
]

// 表单内 Select 选项
const siteOptions = computed(() => sites.value.map((s) => ({ label: s.displayName, value: s.id })))
const downloaderOptions = computed(() => downloaders.value.map((d) => ({ label: d.name, value: d.id })))
const sortRuleSelectOptions = sortRuleOptions.map((o) => ({ label: o.label, value: o.value }))
const seederConditionOptions = [
  { label: '不限制', value: '' },
  { label: '大于', value: 'GT' },
  { label: '等于', value: 'EQ' },
  { label: '小于', value: 'LT' }
]


const statCards = computed(() => [
  { label: '全部任务', value: stats.value.total, className: '' },
  { label: '自动执行', value: stats.value.autoRunEnabled, className: 'success' },
  { label: '运行中', value: stats.value.running, className: 'warning' },
  { label: '失败', value: stats.value.failed, className: 'danger' }
])

// 响应式判断：移动端 < 768px 使用 varlet 组件优化体验
const isDesktop = useMediaQuery('(min-width: 768px)')

function resetForm() {
  editingTaskId.value = undefined
  Object.assign(form, {
    name: '',
    siteId: sites.value[0]?.id || '',
    downloaderId: downloaders.value[0]?.id || '',
    autoRunEnabled: false,
    intervalMinutes: 30,
    onlyFreeDownload: true,
    deleteOnFreeExpire: false,
    lowUploadKbps: 0,
    lowUploadMinutes: 0,
    autoPush: true,
    discountTypes: ['FREE', 'TWO_X_FREE'],
    seederCondition: '',
    seederCount: 0,
    sizeMinGb: 0,
    sizeMaxGb: 0,
    torrentCountCondition: '',
    torrentCount: 0,
    sortRule: '',
    savePathOverride: '',
    categoryOverride: undefined,
    tagsOverride: undefined
  })
}

function openCreate() {
  resetForm()
  showOnlyFreeDownloadHint.value = false
  formVisible.value = true
}

function openEdit(task: TaskItem) {
  editingTaskId.value = task.id
  showOnlyFreeDownloadHint.value = false
  Object.assign(form, {
    name: task.name,
    siteId: task.siteId,
    downloaderId: task.downloaderId,
    autoRunEnabled: task.autoRunEnabled,
    intervalMinutes: task.intervalMinutes,
    onlyFreeDownload: task.onlyFreeDownload ?? false,
    deleteOnFreeExpire: task.deleteOnFreeExpire ?? false,
    lowUploadKbps: task.lowUploadKbps ?? 0,
    lowUploadMinutes: task.lowUploadMinutes ?? 0,
    autoPush: task.autoPush,
    discountTypes: [...task.discountTypes],
    seederCondition: task.seederCondition ?? '',
    seederCount: task.seederCount ?? 0,
    sizeMinGb: task.sizeMinGb ?? 0,
    sizeMaxGb: task.sizeMaxGb ?? 0,
    torrentCountCondition: task.torrentCountCondition ?? '',
    torrentCount: task.torrentCount ?? 0,
    sortRule: task.sortRule ?? '',
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
  if (!Number.isInteger(form.intervalMinutes) || form.intervalMinutes < 10) return '执行间隔不能小于 10 分钟'
  if (!form.discountTypes.length) return '请至少选择一种优惠类型'
  if (form.seederCondition && (!Number.isInteger(form.seederCount) || (form.seederCount ?? 0) < 0)) return '做种人数必须是大于等于 0 的整数'
  if (!Number.isInteger(form.sizeMinGb) || (form.sizeMinGb ?? 0) < 0) return '种子最小体积必须是大于等于 0 的整数'
  if (!Number.isInteger(form.sizeMaxGb) || (form.sizeMaxGb ?? 0) < 0) return '种子最大体积必须是大于等于 0 的整数'
  if ((form.sizeMinGb ?? 0) > 0 && (form.sizeMaxGb ?? 0) > 0 && (form.sizeMinGb ?? 0) > (form.sizeMaxGb ?? 0)) return '种子最小体积不能大于种子最大体积'
  if ((form.torrentCount ?? 0) > 0 && !Number.isInteger(form.torrentCount)) return '入库数量必须是非负整数'
  const kbps = Number(form.lowUploadKbps) || 0
  const mins = Number(form.lowUploadMinutes) || 0
  if ((kbps > 0) !== (mins > 0)) return '低速删除的速度阈值和持续时间需同时填写'
  if (kbps > 0 && (!Number.isInteger(kbps) || kbps < 1)) return '低速删除的速度阈值必须是大于等于 1 的整数'
  if (mins > 0 && (!Number.isInteger(mins) || mins < 1)) return '低速删除的持续时间必须是大于等于 1 的整数'
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
    const payload: TaskPayload = {
      name: form.name,
      siteId: form.siteId,
      downloaderId: form.downloaderId,
      autoRunEnabled: form.autoRunEnabled,
      intervalMinutes: form.intervalMinutes,
      onlyFreeDownload: form.onlyFreeDownload,
      deleteOnFreeExpire: form.deleteOnFreeExpire,
      lowUploadKbps: (form.lowUploadKbps ?? 0) > 0 ? Number(form.lowUploadKbps) : null,
      lowUploadMinutes: (form.lowUploadMinutes ?? 0) > 0 ? Number(form.lowUploadMinutes) : null,
      autoPush: form.autoPush,
      discountTypes: form.discountTypes,
      seederCondition: form.seederCondition,
      seederCount: form.seederCount,
      sizeMinGb: form.sizeMinGb,
      sizeMaxGb: form.sizeMaxGb,
      torrentCountCondition: (form.torrentCount ?? 0) > 0 ? 'LT' : '',
      torrentCount: form.torrentCount,
      sortRule: form.sortRule || undefined,
      savePathOverride: form.savePathOverride,
      categoryOverride: form.categoryOverride,
      tagsOverride: form.tagsOverride
    }
    if (editingTaskId.value) await updateTask(editingTaskId.value, payload)
    else await createTask(payload)
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
  if (testingTaskId.value) return
  testingTaskId.value = task.id
  try {
    testResult.value = await testTask(task.id)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试失败')
  } finally {
    testingTaskId.value = undefined
  }
}

async function runExistingTask(task: TaskItem) {
  try {
    task.running = true
    task.lastSummary = '运行中'
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
  return value === 'TWO_X_FREE' ? '2X FREE' : value === 'HALF_FREE' ? '50% FREE' : value === 'NORMAL' ? '不免费' : value
}

function freeEndText(item: TaskTestResult['items'][number]) {
  if (item.freeEndAt) return `免费至 ${formatDate(item.freeEndAt)}`
  if (item.isFreeNow) return '免费中，未获取到过期时间'
  return '非免费'
}

function rangeText(task: TaskItem) {
  const parts = [task.discountTypes.map(discountText).join(', ')]
  if (task.onlyFreeDownload) parts.push('仅免费下载')
  if (task.deleteOnFreeExpire) parts.push('免费到期')
  if (task.lowUploadKbps && task.lowUploadMinutes) parts.push(`低速 ${task.lowUploadKbps}KB/s·${task.lowUploadMinutes}分钟`)
  if (task.seederCondition) parts.push(`做种${seederConditionText[task.seederCondition]} ${task.seederCount ?? 0}`)
  const sizeMin = task.sizeMinGb ?? 0
  const sizeMax = task.sizeMaxGb ?? 0
  if (sizeMin > 0 || sizeMax > 0) {
    if (sizeMin > 0 && sizeMax > 0) parts.push(`体积 ${sizeMin}~${sizeMax} GB`)
    else if (sizeMin > 0) parts.push(`体积 ≥ ${sizeMin} GB`)
    else parts.push(`体积 ≤ ${sizeMax} GB`)
  }
  if (task.torrentCountCondition && (task.torrentCount ?? 0) > 0) parts.push(`入库数量 ${task.torrentCount}`)
  if (task.sortRule) {
    const opt = sortRuleOptions.find((item) => item.value === task.sortRule)
    if (opt) parts.push(`排序：${opt.label}`)
  }
  return parts.join(' · ')
}

function statusText(task: TaskItem) {
  if (task.running) return task.lastRunMode === 'AUTO' ? '定时运行中' : '手动运行中'
  if (task.lastStatus === 'SUCCESS') return '成功'
  if (task.lastStatus === 'FAILED') return '失败'
  return '未运行'
}

function statusClass(task: TaskItem) {
  if (task.running) return 'warning-chip'
  if (task.lastStatus === 'FAILED') return 'offline-chip'
  if (task.lastStatus === 'SUCCESS') return 'online-chip'
  return 'muted-chip'
}

onMounted(async () => {
  await loadOptions()
  await loadTasks()
})
</script>
