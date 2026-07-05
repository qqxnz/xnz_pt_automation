<template>
  <AppLayout>
    <section class="settings-page">
      <div class="dashboard-head">
        <div>
          <h1>系统设置</h1>
          <p>维护账号安全、运行信息和系统基础参数。</p>
        </div>
        <div class="head-actions">
          <span>{{ dirty ? '有未保存修改' : lastSavedText }}</span>
          <button class="primary-button compact" type="button" :disabled="!dirty || savingSettings" @click="saveSettings">
            {{ savingSettings ? '保存中...' : '保存设置' }}
          </button>
        </div>
      </div>

      <div v-if="infoError || settingsError" class="error-banner">
        {{ infoError || settingsError }}
        <button type="button" @click="loadAll">重试</button>
      </div>

      <section v-if="systemInfo?.security.defaultPasswordInUse" class="security-alert" ref="securitySection">
        <strong>当前仍在使用默认管理员密码</strong>
        <span>请尽快修改密码，避免部署到 NAS 或公网环境后产生安全风险。</span>
      </section>

      <div class="settings-grid">
        <section class="panel settings-card" ref="passwordSection">
          <div class="panel-title-row">
            <h2>修改密码</h2>
            <span>当前会话保持有效</span>
          </div>
          <form class="settings-form" @submit.prevent="submitPassword">
            <label>旧密码<input v-model="passwordForm.oldPassword" :disabled="changingPassword" type="password" autocomplete="current-password" /></label>
            <label>新密码<input v-model="passwordForm.newPassword" :disabled="changingPassword" type="password" autocomplete="new-password" /></label>
            <label>确认新密码<input v-model="passwordForm.confirmPassword" :disabled="changingPassword" type="password" autocomplete="new-password" /></label>
            <button class="secondary-button blue" type="submit" :disabled="changingPassword">
              {{ changingPassword ? '提交中...' : '更新密码' }}
            </button>
          </form>
        </section>

        <section class="panel settings-card">
          <div class="panel-title-row">
            <h2>系统信息</h2>
            <span>{{ loadingInfo ? '加载中...' : '运行中' }}</span>
          </div>
          <div class="settings-info-grid">
            <article v-for="item in systemInfoItems" :key="item.label">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </article>
          </div>
        </section>
      </div>

      <section class="panel settings-card" ref="settingsSection">
        <div class="panel-title-row">
          <h2>基础参数</h2>
          <span>{{ loadingSettings ? '加载中...' : '一次保存全部参数' }}</span>
        </div>

        <div class="settings-groups">
          <section ref="sessionSection">
            <h3>会话</h3>
            <div class="settings-form two-columns">
              <label>登录态有效期（小时）<input v-model.number="settingsForm.sessionTtlHours" type="number" min="1" max="720" /></label>
              <label>最大并发任务数<input v-model.number="settingsForm.maxConcurrentTasks" type="number" min="1" max="10" /></label>
            </div>
          </section>

          <section ref="networkSection">
            <h3>网络</h3>
            <div class="settings-form two-columns">
              <label>请求超时时间（ms）<input v-model.number="settingsForm.requestTimeoutMs" type="number" min="3000" max="120000" step="1000" /></label>
              <label class="wide-field">默认 User-Agent<input v-model.trim="settingsForm.defaultUserAgent" /></label>
            </div>
          </section>
        </div>
      </section>

      <section class="panel settings-card" ref="backupSection">
        <div class="panel-title-row">
          <h2>数据库备份</h2>
          <span>{{ loadingBackups ? '加载中...' : '读取 dataDir 目录' }}</span>
        </div>

        <div class="settings-info-grid backup-summary">
          <article>
            <span>数据目录</span>
            <strong>{{ backupDataDir || '-' }}</strong>
          </article>
          <article>
            <span>最近一次备份</span>
            <strong>{{ lastBackupAtText }}</strong>
          </article>
          <article>
            <span>备份文件数量</span>
            <strong>{{ backups.length }}</strong>
          </article>
        </div>

        <div class="backup-tip">
          备份文件可直接移出本目录以节省空间，再点击"刷新"即可从列表中隐藏；移回 dataDir 会自动重新出现。本系统不会自动生成定时备份，请通过 NAS 计划任务或外部脚本定期触发「立即备份」。
        </div>

        <div class="backup-actions">
          <button class="primary-button compact" type="button" :disabled="creatingBackup || !!restoringName" @click="runBackupNow">
            {{ creatingBackup ? '生成中...' : '立即备份' }}
          </button>
          <button class="secondary-button" type="button" :disabled="loadingBackups || creatingBackup" @click="loadBackups">
            刷新列表
          </button>
          <span v-if="backupError" class="backup-error">{{ backupError }}</span>
        </div>

        <div v-if="backups.length" class="backup-table">
          <div class="backup-table-head">
            <span>文件名</span>
            <span>大小</span>
            <span>修改时间</span>
            <span>操作</span>
          </div>
          <div v-for="item in backups" :key="item.name" class="backup-table-row">
            <span class="backup-name" :title="item.name">{{ item.name }}</span>
            <span>{{ formatBytes(item.sizeBytes) }}</span>
            <span :title="item.mtime">{{ formatDate(item.mtime) }}</span>
            <span class="backup-row-actions">
              <button class="text-button" type="button" :disabled="downloadingName === item.name" @click="downloadBackup(item.name)">
                {{ downloadingName === item.name ? '下载中...' : '下载' }}
              </button>
              <button class="text-button danger" type="button" :disabled="!!restoringName || deletingName === item.name" @click="confirmRestore(item.name)">
                {{ restoringName === item.name ? '恢复中...' : '恢复' }}
              </button>
              <button class="text-button" type="button" :disabled="!!restoringName || deletingName === item.name" @click="removeBackup(item.name)">
                {{ deletingName === item.name ? '删除中...' : '删除' }}
              </button>
            </span>
          </div>
        </div>
        <div v-else class="empty-tip backup-empty">暂无备份文件，将 db-*.sqlite3 放入 dataDir 后点击「刷新」即可显示。</div>
      </section>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { Dialog, Snackbar } from '@varlet/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import {
  deleteBackup as apiDeleteBackup,
  listBackups as apiListBackups,
  restoreBackup as apiRestoreBackup,
  runBackup as apiRunBackup,
  triggerBrowserDownload,
  type BackupItem
} from '../api/backup'
import {
  changePassword,
  getSystemInfo,
  getSystemSettings,
  updateSystemSettings,
  type SystemInfo,
  type SystemSettings
} from '../api/settings'

const route = useRoute()
const loadingInfo = ref(false)
const loadingSettings = ref(false)
const savingSettings = ref(false)
const changingPassword = ref(false)
const infoError = ref('')
const settingsError = ref('')
const systemInfo = ref<SystemInfo>()
const savedSettings = ref<SystemSettings>()
const settingsUpdatedAt = ref<string>()
const securitySection = ref<HTMLElement>()
const passwordSection = ref<HTMLElement>()
const settingsSection = ref<HTMLElement>()
const sessionSection = ref<HTMLElement>()
const networkSection = ref<HTMLElement>()
const backupSection = ref<HTMLElement>()
const backups = ref<BackupItem[]>([])
const backupDataDir = ref('')
const backupLastAt = ref<string>()
const loadingBackups = ref(false)
const backupError = ref('')
const creatingBackup = ref(false)
const downloadingName = ref<string>()
const deletingName = ref<string>()
const restoringName = ref<string>()


const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const settingsForm = reactive<SystemSettings>({
  sessionTtlHours: 168,
  requestTimeoutMs: 15000,
  maxConcurrentTasks: 2,
  defaultUserAgent: navigator.userAgent
})

const dirty = computed(() => JSON.stringify(settingsForm) !== JSON.stringify(savedSettings.value ?? settingsForm))
const lastSavedText = computed(() => (settingsUpdatedAt.value ? `保存于 ${formatDate(settingsUpdatedAt.value)}` : '设置已同步'))
const systemInfoItems = computed(() => {
  const info = systemInfo.value
  if (!info) return []
  return [
    { label: '系统版本', value: info.version },
    { label: '运行环境', value: info.runtimeEnv },
    { label: 'Node.js', value: info.nodeVersion },
    { label: '启动时间', value: formatDate(info.startedAt) },
    { label: '系统时区', value: info.timezone },
    { label: '数据库类型', value: info.database.type },
    { label: '数据库路径', value: info.database.path },
    { label: '数据库大小', value: formatBytes(info.database.sizeBytes) },
    { label: 'Schema 版本', value: info.database.schemaVersion },
    { label: '最近迁移结果', value: migrationText(info.database.lastMigrationStatus) },
    { label: '数据目录', value: info.paths.dataDir || '-' },
    { label: '日志目录', value: info.paths.logDir || '-' },
    { label: '缓存目录', value: info.paths.cacheDir || '-' }
  ]
})

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatBytes(value?: number) {
  if (value === undefined) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unitIndex ? 2 : 0 }).format(size)} ${units[unitIndex]}`
}

function migrationText(value?: SystemInfo['database']['lastMigrationStatus']) {
  if (value === 'FAILED') return '失败'
  if (value === 'PENDING') return '待执行'
  return '正常'
}

async function loadInfo() {
  loadingInfo.value = true
  infoError.value = ''
  try {
    systemInfo.value = await getSystemInfo()
  } catch (err) {
    infoError.value = err instanceof Error ? err.message : '系统信息加载失败'
  } finally {
    loadingInfo.value = false
  }
}

async function loadSettings() {
  loadingSettings.value = true
  settingsError.value = ''
  try {
    const result = await getSystemSettings()
    Object.assign(settingsForm, result.settings)
    savedSettings.value = { ...result.settings }
    settingsUpdatedAt.value = result.updatedAt
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : '系统设置加载失败'
  } finally {
    loadingSettings.value = false
  }
}

async function loadAll() {
  await Promise.all([loadInfo(), loadSettings(), loadBackups()])
}

async function loadBackups() {
  loadingBackups.value = true
  backupError.value = ''
  try {
    const result = await apiListBackups()
    backups.value = result.backups
    backupDataDir.value = result.dataDir
    backupLastAt.value = result.lastBackupAt
  } catch (err) {
    backupError.value = err instanceof Error ? err.message : '备份列表加载失败'
  } finally {
    loadingBackups.value = false
  }
}

const lastBackupAtText = computed(() => (backupLastAt.value ? formatDate(backupLastAt.value) : '尚未生成'))

async function runBackupNow() {
  creatingBackup.value = true
  try {
    const result = await apiRunBackup()
    Snackbar.success(`已生成备份：${result.backup.name}`)
    await loadBackups()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '备份失败')
  } finally {
    creatingBackup.value = false
  }
}

async function downloadBackup(name: string) {
  downloadingName.value = name
  try {
    await triggerBrowserDownload(name)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '下载失败')
  } finally {
    downloadingName.value = undefined
  }
}

async function removeBackup(name: string) {
  const confirmed = window.confirm(`确认删除备份 ${name} 吗？此操作不可撤销。`)
  if (!confirmed) return
  deletingName.value = name
  try {
    await apiDeleteBackup(name)
    Snackbar.success(`已删除：${name}`)
    await loadBackups()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    deletingName.value = undefined
  }
}

function confirmRestore(name: string) {
  Dialog({
    title: '确认恢复数据库',
    message: `将把当前数据库替换为备份 ${name}，并自动重启 PM2 / Docker 实例（检测到哪种就哪种）。继续吗？`,
    onConfirm: async () => {
      restoringName.value = name
      try {
        const result = await apiRestoreBackup(name)
        Dialog({
          title: '恢复成功',
          message: `${result.message}（运行时：${result.runtime}），约 1-2 秒后会自动重新加载页面…`,
          onClose: () => undefined
        })
        setTimeout(() => window.location.reload(), 2000)
      } catch (err) {
        const message = err instanceof Error ? err.message : '恢复失败'
        if (message.includes('已被移走') || message.includes('BACKUP_NOT_FOUND')) {
          await loadBackups()
          Snackbar.warning('备份文件已不在数据目录，恢复已取消。')
        } else {
          Snackbar.error(message)
        }
        restoringName.value = undefined
      }
    }
  })
}

function validatePasswordForm() {
  if (!passwordForm.oldPassword) return '旧密码必填'
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(passwordForm.newPassword)) return '新密码需为 8-64 位，且至少包含字母和数字'
  if (passwordForm.oldPassword === passwordForm.newPassword) return '新密码不能与旧密码相同'
  if (passwordForm.newPassword !== passwordForm.confirmPassword) return '两次新密码不一致'
  return ''
}

function validateSettingsForm() {
  if (!Number.isInteger(settingsForm.sessionTtlHours) || settingsForm.sessionTtlHours < 1 || settingsForm.sessionTtlHours > 720) return '登录态有效期需在 1-720 小时之间'
  if (!Number.isInteger(settingsForm.maxConcurrentTasks) || settingsForm.maxConcurrentTasks < 1 || settingsForm.maxConcurrentTasks > 10) return '最大并发任务数需在 1-10 之间'
  if (!Number.isInteger(settingsForm.requestTimeoutMs) || settingsForm.requestTimeoutMs < 3000 || settingsForm.requestTimeoutMs > 120000) return '请求超时时间需在 3000-120000 ms 之间'
  if (settingsForm.defaultUserAgent.trim().length < 20 || settingsForm.defaultUserAgent.trim().length > 300) return '默认 User-Agent 需为 20-300 字'
  return ''
}

async function submitPassword() {
  const error = validatePasswordForm()
  if (error) {
    Snackbar.warning(error)
    return
  }
  changingPassword.value = true
  try {
    await changePassword({ oldPassword: passwordForm.oldPassword, newPassword: passwordForm.newPassword })
    Object.assign(passwordForm, { oldPassword: '', newPassword: '', confirmPassword: '' })
    Snackbar.success('密码已更新')
    await loadInfo()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '密码修改失败')
  } finally {
    changingPassword.value = false
  }
}

async function saveSettings() {
  const error = validateSettingsForm()
  if (error) {
    Snackbar.warning(error)
    return
  }
  savingSettings.value = true
  try {
    const result = await updateSystemSettings({ ...settingsForm, defaultUserAgent: settingsForm.defaultUserAgent.trim() })
    Object.assign(settingsForm, result.settings)
    savedSettings.value = { ...result.settings }
    settingsUpdatedAt.value = result.updatedAt
    Snackbar.success('系统设置已保存')
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '设置保存失败')
  } finally {
    savingSettings.value = false
  }
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

async function focusSection() {
  await nextTick()
  const section = String(route.query.section ?? '')
  const target = section === 'password'
    ? passwordSection.value || securitySection.value
    : section === 'network'
      ? networkSection.value
      : section === 'session'
        ? sessionSection.value
        : section === 'backup'
          ? backupSection.value
          : settingsSection.value
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onBeforeRouteLeave(() => {
  if (!dirty.value) return true
  return window.confirm('系统设置尚未保存，确认离开？')
})

onMounted(async () => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  await loadAll()
  if (route.query.section) await focusSection()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<style scoped>
.backup-summary {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-bottom: 16px;
}

.backup-tip {
  font-size: 14px;
  line-height: 1.6;
  padding: 12px 14px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: #f1f5f9;
  color: #475569;
}

.backup-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.backup-error {
  color: #dc2626;
  font-size: 13px;
}

.backup-table {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}

.backup-table-head,
.backup-table-row {
  display: grid;
  grid-template-columns: minmax(0, 2.4fr) minmax(0, 0.8fr) minmax(0, 1.2fr) minmax(0, 1.4fr);
  gap: 12px;
  padding: 12px 14px;
  align-items: center;
  font-size: 14px;
}

.backup-table-head {
  background: #f8fafc;
  color: #475569;
  font-weight: 700;
}

.backup-table-row + .backup-table-row {
  border-top: 1px solid #e2e8f0;
}

.backup-table-row:hover {
  background: #f8fafc;
}

.backup-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.backup-row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.backup-empty {
  border-style: dashed;
  border-width: 1px;
  border-color: #cbd5e1;
  border-radius: 12px;
  padding: 18px;
  color: #64748b;
}

.backup-row-actions .text-button.danger {
  color: #b91c1c;
}
</style>
