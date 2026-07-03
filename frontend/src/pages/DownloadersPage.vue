<template>
  <AppLayout>
    <section class="downloaders-page">
      <div class="dashboard-head">
        <div>
          <h1>下载器</h1>
          <p>配置 qBittorrent 连接并测试下载器状态</p>
        </div>
        <div class="head-actions">
          <button class="primary-button compact" type="button" @click="openCreate">新增下载器</button>
          <button class="secondary-button outline" type="button" @click="handleExport">导出</button>
          <button class="secondary-button outline" type="button" @click="triggerImport">导入</button>
          <input ref="importInputRef" type="file" accept=".json" hidden @change="handleImport" />
        </div>
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
              <h2>下载器列表</h2>
              <span>{{ items.length }} 个下载器</span>
            </div>

            <div v-if="loading && !items.length" class="empty-tip">下载器列表加载中...</div>
            <div v-else-if="!items.length" class="sites-empty">
              <h2>还没有下载器</h2>
              <p>添加 qBittorrent 下载器后，任务就可以推送种子。</p>
              <button class="primary-button compact" type="button" @click="openCreate">新增下载器</button>
            </div>
            <div v-else class="downloader-list-panel">
              <article v-for="downloader in items" :key="downloader.id" class="downloader-card">
                <div class="downloader-card-main">
                  <div class="downloader-card-title">
                    <h3>{{ downloader.name }}</h3>
                    <span class="chip" :class="statusMeta(displayStatus(downloader)).className">{{ statusMeta(displayStatus(downloader)).label }}</span>
                    <span v-if="downloader.hasIpv6Peers" class="chip ipv6-chip" :title="`${downloader.ipv6TorrentCount ?? 0} 个种子有 IPV6 peer 连接`">IPv6</span>
                    <span v-if="!downloader.enabled" class="chip muted-chip">已禁用</span>
                  </div>
                  <dl class="downloader-card-meta">
                    <div>
                      <dt>类型</dt>
                      <dd>qBittorrent</dd>
                    </div>
                    <div>
                      <dt>服务地址</dt>
                      <dd>{{ downloader.host }}</dd>
                    </div>
                    <div>
                      <dt>默认路径</dt>
                      <dd>{{ downloader.savePath || '使用下载器默认路径' }}</dd>
                    </div>
                    <div>
                      <dt>最近同步</dt>
                      <dd>{{ formatDate(statusById[downloader.id]?.lastSyncedAt || downloader.lastSyncedAt) }}</dd>
                    </div>
                  </dl>
                  <div class="downloader-card-status-grid">
                    <article>
                      <span>上传速度</span>
                      <strong class="success">{{ formatSpeed(statusById[downloader.id]?.uploadSpeed) }}</strong>
                    </article>
                    <article>
                      <span>下载速度</span>
                      <strong>{{ formatSpeed(statusById[downloader.id]?.downloadSpeed) }}</strong>
                    </article>
                  </div>
                  <p v-if="statusErrors[downloader.id] || downloader.statusMessage" class="downloader-card-message">
                    {{ statusErrors[downloader.id] || downloader.statusMessage }}
                  </p>
                </div>
                <div class="row-actions downloader-card-actions">
                  <button type="button" @click="testDownloaderItem(downloader)">测试</button>
                  <button type="button" @click="openEdit(downloader)">编辑</button>
                  <button class="danger-text" type="button" @click="removeDownloader(downloader)">删除</button>
                </div>
              </article>
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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import {
  createDownloader,
  deleteDownloader,
  exportDownloaders,
  getDownloader,
  getDownloaders,
  getDownloaderStatus,
  importDownloaders,
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
const items = ref<DownloaderListItem[]>([])
const stats = ref<DownloaderStats>({ total: 0, online: 0, authFailed: 0, offline: 0, unknown: 0 })
const statusById = ref<Record<string, DownloaderStatus | undefined>>({})
const statusErrors = ref<Record<string, string | undefined>>({})
const formVisible = ref(false)
const editingDownloaderId = ref<string>()
const detailHasPassword = ref(false)
const downloaderPasswordVisible = ref(false)
const originalDownloaderPassword = ref('')
const testAfterSave = ref(true)
const draftTestResult = ref<DownloaderTestResult>()
let statusTimer: number | undefined
const importInputRef = ref<HTMLInputElement>()

const form = reactive<DownloaderFormPayload>({
  name: '',
  type: 'QBITTORRENT',
  enabled: true,
  host: '',
  username: '',
  password: '',
  savePath: ''
})

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

function displayStatus(downloader: DownloaderListItem) {
  return statusById.value[downloader.id]?.status ?? downloader.status
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
    const ids = new Set(result.items.map((item) => item.id))
    statusById.value = Object.fromEntries(Object.entries(statusById.value).filter(([id]) => ids.has(id)))
    statusErrors.value = Object.fromEntries(Object.entries(statusErrors.value).filter(([id]) => ids.has(id)))
    startStatusPolling()
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
    if (testAfterSave.value) {
      const result = await testDownloader(saved.id)
      Snackbar[result.success ? 'success' : 'error'](result.message)
    } else {
      Snackbar.success('下载器已保存')
    }
    formVisible.value = false
    await loadDownloaders()
    await refreshAllStatuses()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function testDownloaderItem(downloader: DownloaderListItem) {
  try {
    const result = await testDownloader(downloader.id)
    Snackbar.success(result.message)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试失败')
  }
  await loadDownloaders()
  await refreshDownloaderStatus(downloader)
}

async function removeDownloader(downloader: DownloaderListItem) {
  if (!window.confirm(`确认删除下载器「${downloader.name}」？`)) return
  await deleteDownloader(downloader.id)
  Snackbar.success('下载器已删除')
  await loadDownloaders()
  await refreshAllStatuses()
}

async function refreshDownloaderStatus(downloader: DownloaderListItem) {
  if (!downloader.enabled || document.hidden) return
  try {
    const status = await getDownloaderStatus(downloader.id)
    statusById.value = { ...statusById.value, [downloader.id]: status }
    statusErrors.value = { ...statusErrors.value, [downloader.id]: undefined }
  } catch (err) {
    statusErrors.value = {
      ...statusErrors.value,
      [downloader.id]: err instanceof Error ? err.message : '状态刷新失败'
    }
  }
}

async function refreshAllStatuses() {
  for (const downloader of items.value) {
    await refreshDownloaderStatus(downloader)
  }
}

function stopStatusPolling() {
  if (statusTimer !== undefined) window.clearInterval(statusTimer)
  statusTimer = undefined
}

function startStatusPolling() {
  stopStatusPolling()
  if (!items.value.length) return
  statusTimer = window.setInterval(refreshAllStatuses, 5000)
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopStatusPolling()
  } else {
    refreshAllStatuses()
    startStatusPolling()
  }
}

async function handleExport() {
  try {
    const { blob, filename } = await exportDownloaders()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
    Snackbar.success('下载器配置已导出')
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '导出失败')
  }
}

function triggerImport() {
  importInputRef.value?.click()
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const result = await importDownloaders(file)
    Snackbar.success(`导入完成：成功 ${result.imported} 个，失败 ${result.failed} 个`)
    if (result.errors.length) {
      result.errors.forEach((msg) => Snackbar.warning(msg))
    }
    await loadDownloaders()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '导入失败')
  } finally {
    input.value = ''
  }
}

onMounted(async () => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (route.query.action === 'create') openCreate()
  await loadDownloaders()
  await refreshAllStatuses()
  startStatusPolling()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopStatusPolling()
})
</script>
