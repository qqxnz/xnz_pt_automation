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

          <section ref="retentionSection">
            <h3>数据保留</h3>
            <div class="settings-form three-columns">
              <label>操作日志保留（天）<input v-model.number="settingsForm.operationLogRetentionDays" type="number" min="7" max="3650" /></label>
              <label>任务日志保留（天）<input v-model.number="settingsForm.taskLogRetentionDays" type="number" min="7" max="3650" /></label>
              <label>种子记录保留（天）<input v-model.number="settingsForm.torrentRetentionDays" type="number" min="30" max="3650" /></label>
            </div>
          </section>
        </div>
      </section>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
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
const retentionSection = ref<HTMLElement>()

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const settingsForm = reactive<SystemSettings>({
  sessionTtlHours: 168,
  operationLogRetentionDays: 180,
  taskLogRetentionDays: 60,
  torrentRetentionDays: 365,
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
  await Promise.all([loadInfo(), loadSettings()])
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
  if (!Number.isInteger(settingsForm.operationLogRetentionDays) || settingsForm.operationLogRetentionDays < 7 || settingsForm.operationLogRetentionDays > 3650) return '操作日志保留天数需在 7-3650 天之间'
  if (!Number.isInteger(settingsForm.taskLogRetentionDays) || settingsForm.taskLogRetentionDays < 7 || settingsForm.taskLogRetentionDays > 3650) return '任务日志保留天数需在 7-3650 天之间'
  if (!Number.isInteger(settingsForm.torrentRetentionDays) || settingsForm.torrentRetentionDays < 30 || settingsForm.torrentRetentionDays > 3650) return '种子记录保留天数需在 30-3650 天之间'
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
      : section === 'retention'
        ? retentionSection.value
        : section === 'session'
          ? sessionSection.value
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
