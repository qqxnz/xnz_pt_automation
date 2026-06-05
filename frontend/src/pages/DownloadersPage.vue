<template>
  <AppLayout>
    <section class="downloaders-page">
      <div class="dashboard-head">
        <div>
          <h1>下载器</h1>
          <p>配置 qBittorrent 连接并测试下载器状态</p>
        </div>
        <button class="primary-button compact" type="button" @click="openCreate">新增下载器</button>
      </div>

      <section class="site-stats">
        <article v-for="card in statCards" :key="card.label" class="metric-card">
          <span>{{ card.label }}</span>
          <strong :class="card.className">{{ card.value }}</strong>
        </article>
      </section>

      <section class="downloaders-layout">
        <main class="downloaders-main">
          <section class="panel">
            <div v-if="error" class="error-banner">
              {{ error }}
              <button type="button" @click="loadDownloaders">重试</button>
            </div>
            <div class="panel-title-row">
              <h2>{{ selectedDownloader?.name || '下载器状态' }}</h2>
              <div v-if="selectedDownloader" class="row-actions">
                <button type="button" @click="testSelected">测试</button>
                <button type="button" @click="openEdit(selectedDownloader)">编辑</button>
                <button class="danger-text" type="button" @click="removeDownloader(selectedDownloader)">删除</button>
              </div>
            </div>

            <div v-if="loading && !selectedDownloader" class="empty-tip">下载器状态加载中...</div>
            <div v-else-if="!selectedDownloader" class="sites-empty">
              <h2>还没有下载器</h2>
              <p>添加 qBittorrent 下载器后，任务就可以推送种子。</p>
              <button class="primary-button compact" type="button" @click="openCreate">新增下载器</button>
            </div>
            <div v-else>
              <div class="downloader-status-grid">
                <article>
                  <span>上传速度</span>
                  <strong class="success">{{ formatSpeed(currentStatus?.uploadSpeed) }}</strong>
                </article>
                <article>
                  <span>下载速度</span>
                  <strong>{{ formatSpeed(currentStatus?.downloadSpeed) }}</strong>
                </article>
                <article>
                  <span>总上传</span>
                  <strong>{{ formatBytes(currentStatus?.totalUploaded) }}</strong>
                </article>
                <article>
                  <span>总下载</span>
                  <strong>{{ formatBytes(currentStatus?.totalDownloaded) }}</strong>
                </article>
              </div>
              <div class="downloader-detail-line">
                <span class="chip" :class="statusMeta(selectedDownloader.status).className">{{ statusMeta(selectedDownloader.status).label }}</span>
                <span>默认路径：{{ selectedDownloader.savePath || '使用下载器 QB/TR 默认路径' }}</span>
                <span>剩余空间：{{ formatBytes(currentStatus?.freeSpace) }}</span>
                <span>最近同步：{{ formatDate(currentStatus?.lastSyncedAt || selectedDownloader.lastSyncedAt) }}</span>
              </div>
              <div v-if="statusError" class="error-banner compact-error">
                {{ statusError }}
                <button type="button" @click="refreshSelectedStatus">重试</button>
              </div>
            </div>
          </section>
        </main>
      </section>
    </section>

    <div v-if="formVisible" class="modal-backdrop" @click.self="closeForm">
      <form class="site-form downloader-form" @submit.prevent="saveDownloader">
        <div class="form-head">
          <div>
            <h2>{{ editingDownloaderId ? `编辑下载器 - ${form.name || ''}` : '新增下载器' }}</h2>
            <p>编辑时显示已保存密码；修改后保存即更新。</p>
          </div>
          <button type="button" @click="closeForm">×</button>
        </div>

        <div class="form-grid compact-form-grid">
          <section>
            <h3>基础信息</h3>
            <label>下载器名称<input v-model.trim="form.name" required placeholder="NAS QB" /></label>
            <label>
              类型
              <select v-model="form.type" disabled>
                <option value="QBITTORRENT">qBittorrent</option>
              </select>
            </label>
            <label class="inline-check"><input v-model="form.enabled" type="checkbox" /> 启用下载器</label>
          </section>

          <section>
            <h3>连接信息</h3>
            <label>服务地址<input v-model.trim="form.host" required placeholder="http://nas:8080" /></label>
            <label>用户名<input v-model.trim="form.username" placeholder="可选" /></label>
            <label>
              密码
              <div class="password-input">
                <input
                  v-model="form.password"
                  :type="downloaderPasswordVisible ? 'text' : 'password'"
                  :placeholder="passwordPlaceholder"
                />
                <button type="button" :disabled="saving || testingDraft" @click="downloaderPasswordVisible = !downloaderPasswordVisible">
                  {{ downloaderPasswordVisible ? '隐藏' : '显示' }}
                </button>
              </div>
            </label>
          </section>

          <section>
            <h3>默认推送设置</h3>
            <label>默认保存路径<input v-model.trim="form.savePath" placeholder="不填则使用下载器 QB/TR 默认路径" /></label>
            <label class="inline-check"><input v-model="testAfterSave" type="checkbox" /> 保存后测试连接</label>
            <div v-if="draftTestResult" class="empty-tip compact-tip" :class="{ 'success-tip': draftTestResult.success }">
              {{ draftTestResult.message }}
              <span v-if="draftTestResult.version"> · {{ draftTestResult.version }}</span>
            </div>
            <div class="empty-tip compact-tip">分类和标签由任务推送配置决定。</div>
          </section>
        </div>

        <div class="form-foot">
          <span>校验：名称唯一；服务地址必须包含 http(s)；编辑时不改密码则保持原值。</span>
          <button type="button" class="secondary-button" @click="closeForm">取消</button>
          <button type="button" class="secondary-button blue" :disabled="saving || testingDraft" @click="testDraft">
            {{ testingDraft ? '测试中...' : '测试连接' }}
          </button>
          <button class="primary-button compact" :disabled="saving" type="submit">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </form>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import {
  createDownloader,
  deleteDownloader,
  getDownloader,
  getDownloaders,
  getDownloaderStatus,
  testDownloader,
  testDownloaderDraft,
  updateDownloader,
  type DownloaderFormPayload,
  type DownloaderListItem,
  type DownloaderStats,
  type DownloaderStatus,
  type DownloaderTestResult
} from '../api/downloaders'

const route = useRoute()
const loading = ref(false)
const saving = ref(false)
const testingDraft = ref(false)
const error = ref('')
const statusError = ref('')
const items = ref<DownloaderListItem[]>([])
const stats = ref<DownloaderStats>({ total: 0, online: 0, authFailed: 0, offline: 0, unknown: 0 })
const selectedId = ref<string>()
const currentStatus = ref<DownloaderStatus>()
const formVisible = ref(false)
const editingDownloaderId = ref<string>()
const detailHasPassword = ref(false)
const downloaderPasswordVisible = ref(false)
const originalDownloaderPassword = ref('')
const testAfterSave = ref(true)
const draftTestResult = ref<DownloaderTestResult>()
let statusTimer: number | undefined
let failedStatusRefreshes = 0

const form = reactive<DownloaderFormPayload>({
  name: '',
  type: 'QBITTORRENT',
  enabled: true,
  host: '',
  username: '',
  password: '',
  savePath: ''
})

const selectedDownloader = computed(() => items.value.find((item) => item.id === selectedId.value))
const passwordPlaceholder = computed(() => (editingDownloaderId.value && detailHasPassword.value && !form.password ? '已保存，留空不修改' : '可选'))
const statCards = computed(() => [
  { label: '全部下载器', value: stats.value.total, className: '' },
  { label: '在线', value: stats.value.online, className: 'success' },
  { label: '认证失败', value: stats.value.authFailed, className: 'warning' },
  { label: '离线', value: stats.value.offline, className: 'danger' },
  { label: '未检测', value: stats.value.unknown, className: '' }
])

function statusMeta(status: DownloaderListItem['status']) {
  const map = {
    ONLINE: { label: '在线', className: 'online-chip' },
    OFFLINE: { label: '离线', className: 'offline-chip' },
    AUTH_FAILED: { label: '认证失败', className: 'auth-chip' },
    UNKNOWN: { label: '未检测', className: 'unknown-chip' }
  }
  return map[status]
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
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unitIndex === 0 ? 0 : 2 }).format(size)} ${units[unitIndex]}`
}

function formatSpeed(value?: number) {
  if (value === undefined) return '-'
  return `${formatBytes(value)}/s`
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function resetForm() {
  editingDownloaderId.value = undefined
  detailHasPassword.value = false
  downloaderPasswordVisible.value = false
  originalDownloaderPassword.value = ''
  draftTestResult.value = undefined
  testAfterSave.value = true
  Object.assign(form, {
    name: '',
    type: 'QBITTORRENT',
    enabled: true,
    host: '',
    username: '',
    password: '',
    savePath: ''
  })
}

function validateForm() {
  if (!form.name.trim()) return '下载器名称不能为空'
  if (!form.host.trim()) return '服务地址不能为空'
  try {
    const url = new URL(form.host)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid')
  } catch {
    return '服务地址必须是合法的 http(s) 地址，且不能包含用户名或密码'
  }
  return ''
}

async function loadDownloaders() {
  loading.value = true
  error.value = ''
  try {
    const result = await getDownloaders({})
    items.value = result.items
    stats.value = result.stats
    if (!selectedId.value || !items.value.some((item) => item.id === selectedId.value)) selectedId.value = items.value[0]?.id
  } catch (err) {
    error.value = err instanceof Error ? err.message : '下载器列表加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openEdit(downloader: DownloaderListItem) {
  resetForm()
  const detail = await getDownloader(downloader.id)
  editingDownloaderId.value = detail.id
  detailHasPassword.value = detail.hasPassword
  testAfterSave.value = false
  Object.assign(form, {
    name: detail.name,
    type: detail.type,
    enabled: detail.enabled,
    host: detail.host,
    username: detail.username || '',
    password: detail.password || '',
    savePath: detail.savePath || ''
  })
  originalDownloaderPassword.value = detail.password || ''
  formVisible.value = true
}

function closeForm() {
  formVisible.value = false
}

function buildPayload(): DownloaderFormPayload {
  const password = form.password || undefined
  const passwordChanged = editingDownloaderId.value ? form.password !== originalDownloaderPassword.value : Boolean(password)
  return {
    name: form.name.trim(),
    type: 'QBITTORRENT',
    enabled: form.enabled,
    host: form.host.trim(),
    username: form.username?.trim() || undefined,
    password: editingDownloaderId.value ? (passwordChanged ? password : undefined) : password,
    passwordAction: editingDownloaderId.value ? (passwordChanged && password ? 'UPDATE' : 'KEEP') : 'UPDATE',
    savePath: form.savePath?.trim() || undefined
  }
}

async function testDraft() {
  const validation = validateForm()
  if (validation) {
    Snackbar.warning(validation)
    return
  }
  testingDraft.value = true
  draftTestResult.value = undefined
  try {
    const result = await testDownloaderDraft(buildPayload())
    draftTestResult.value = result
    Snackbar.success(result.message)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试失败')
  } finally {
    testingDraft.value = false
  }
}

async function saveDownloader() {
  const validation = validateForm()
  if (validation) {
    Snackbar.warning(validation)
    return
  }

  saving.value = true
  try {
    const payload = buildPayload()
    const saved = editingDownloaderId.value ? await updateDownloader(editingDownloaderId.value, payload) : await createDownloader(payload)
    selectedId.value = saved.id
    if (testAfterSave.value) {
      const result = await testDownloader(saved.id)
      Snackbar[result.success ? 'success' : 'error'](result.message)
    } else {
      Snackbar.success('下载器已保存')
    }
    formVisible.value = false
    await loadDownloaders()
    await refreshSelectedStatus()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function testSelected() {
  if (!selectedDownloader.value) return
  try {
    const result = await testDownloader(selectedDownloader.value.id)
    Snackbar.success(result.message)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试失败')
  }
  await loadDownloaders()
  await refreshSelectedStatus()
}

async function removeDownloader(downloader: DownloaderListItem) {
  if (!window.confirm(`确认删除下载器「${downloader.name}」？`)) return
  await deleteDownloader(downloader.id)
  Snackbar.success('下载器已删除')
  selectedId.value = undefined
  await loadDownloaders()
}

async function refreshSelectedStatus() {
  if (!selectedId.value || document.hidden) {
    if (!selectedId.value) statusError.value = ''
    return
  }
  try {
    currentStatus.value = await getDownloaderStatus(selectedId.value)
    statusError.value = ''
    failedStatusRefreshes = 0
  } catch (err) {
    failedStatusRefreshes += 1
    statusError.value = err instanceof Error ? err.message : '状态刷新失败'
    if (failedStatusRefreshes >= 3) stopStatusPolling()
  }
}

function stopStatusPolling() {
  if (statusTimer !== undefined) window.clearInterval(statusTimer)
  statusTimer = undefined
}

function startStatusPolling() {
  stopStatusPolling()
  if (!selectedId.value) return
  refreshSelectedStatus()
  statusTimer = window.setInterval(refreshSelectedStatus, 3000)
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopStatusPolling()
  } else {
    startStatusPolling()
  }
}

watch(selectedId, () => {
  currentStatus.value = undefined
  statusError.value = ''
  failedStatusRefreshes = 0
  startStatusPolling()
})

onMounted(async () => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (route.query.action === 'create') openCreate()
  await loadDownloaders()
  startStatusPolling()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopStatusPolling()
})
</script>
