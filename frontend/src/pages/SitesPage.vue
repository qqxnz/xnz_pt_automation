<template>
  <AppLayout>
    <section class="sites-page">
      <div class="dashboard-head">
        <div>
          <h1>站点</h1>
          <p>管理 PT 站点域名、API Key、Cookie、连通状态和用户统计</p>
        </div>
        <button class="primary-button compact" type="button" @click="openCreate">新增站点</button>
      </div>

      <section class="site-stats">
        <article v-for="card in statCards" :key="card.label" class="metric-card">
          <span>{{ card.label }}</span>
          <strong :class="card.className">{{ card.value }}</strong>
        </article>
      </section>

      <section class="sites-toolbar panel">
        <input v-model.trim="filters.keyword" placeholder="搜索站点 / 域名" @keyup.enter="loadSites" />
        <select v-model="filters.connectivityStatus" @change="loadSites">
          <option value="ALL">状态：全部</option>
          <option value="ONLINE">在线</option>
          <option value="AUTH_FAILED">认证失败</option>
          <option value="OFFLINE">离线</option>
          <option value="UNKNOWN">未检测</option>
        </select>
        <select v-model="filters.enabled" @change="loadSites">
          <option value="ALL">启用：全部</option>
          <option value="ENABLED">已启用</option>
          <option value="DISABLED">已禁用</option>
        </select>
        <select v-model="filters.signinEnabled" @change="loadSites">
          <option value="ALL">签到：全部</option>
          <option value="ENABLED">已开启</option>
          <option value="DISABLED">已关闭</option>
        </select>
        <button class="secondary-button" type="button" :disabled="loading" @click="loadSites">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </section>

      <section class="sites-table panel">
        <div v-if="error" class="error-banner">
          {{ error }}
          <button type="button" @click="loadSites">重试</button>
        </div>
        <div v-if="!items.length && !loading" class="sites-empty">
          <h2>{{ hasFilters ? '没有符合条件的站点' : '还没有配置 PT 站点' }}</h2>
          <p>{{ hasFilters ? '清空筛选后再试试。' : '添加第一个站点后，系统会开始检查种子和上传下载统计。' }}</p>
          <button class="primary-button compact" type="button" @click="hasFilters ? resetFilters() : openCreate()">
            {{ hasFilters ? '清空筛选' : '新增站点' }}
          </button>
        </div>

        <div v-else class="desktop-table">
          <div class="site-row table-head">
            <span>站点</span>
            <span>连通状态</span>
            <span>用户等级</span>
            <span>分享率</span>
            <span>上传量</span>
            <span>下载量</span>
            <span>昨日上传量</span>
            <span>今日上传量</span>
            <span>凭证</span>
            <span>签到</span>
            <span>操作</span>
          </div>
          <div v-for="site in items" :key="site.id" class="site-row">
            <div>
              <strong>{{ site.displayName }}</strong>
              <small>{{ site.domain }}</small>
            </div>
            <span class="chip" :class="statusMeta(site.connectivityStatus).className">{{ statusMeta(site.connectivityStatus).label }}</span>
            <span>{{ site.userLevel || '-' }}</span>
            <span class="ratio-value" :class="{ good: Boolean(site.ratioInfinite || (site.ratio ?? 0) >= 2), warning: !site.ratioInfinite && (site.ratio ?? 0) > 0 && (site.ratio ?? 0) < 1 }">
              {{ formatRatio(site) }}
            </span>
            <span>{{ formatBytes(site.uploaded) }}</span>
            <span>{{ formatBytes(site.downloaded) }}</span>
            <span>{{ formatBytes(site.yesterdayUploaded) }}</span>
            <span>{{ formatBytes(site.todayUploaded) }}</span>
            <span class="chip muted-chip">{{ credentialLabel(site) }}</span>
            <span class="chip" :class="signinStatusMeta(site).className">{{ signinStatusMeta(site).label }}</span>
            <div class="row-actions">
              <button type="button" :disabled="site.signinRunning" :aria-busy="site.signinRunning" @click="triggerSignin(site)">{{ site.signinRunning ? '签到中...' : '签到' }}</button>
              <button type="button" @click="testSite(site)">测试</button>
              <button type="button" @click="openBrowse(site)">浏览</button>
              <button type="button" @click="openEdit(site)">编辑</button>
              <button class="danger-text" type="button" @click="removeSite(site)">删除</button>
            </div>
          </div>
        </div>

        <div class="mobile-site-list">
          <article v-for="site in items" :key="site.id" class="site-card">
            <div>
              <strong>{{ site.displayName }}</strong>
              <span class="chip" :class="statusMeta(site.connectivityStatus).className">{{ statusMeta(site.connectivityStatus).label }}</span>
            </div>
            <p>{{ site.domain }}</p>
            <dl class="site-stat-grid">
              <div>
                <dt>用户等级</dt>
                <dd>{{ site.userLevel || '-' }}</dd>
              </div>
              <div>
                <dt>分享率</dt>
                <dd>{{ formatRatio(site) }}</dd>
              </div>
              <div>
                <dt>上传量</dt>
                <dd>{{ formatBytes(site.uploaded) }}</dd>
              </div>
              <div>
                <dt>下载量</dt>
                <dd>{{ formatBytes(site.downloaded) }}</dd>
              </div>
              <div>
                <dt>昨日上传量</dt>
                <dd>{{ formatBytes(site.yesterdayUploaded) }}</dd>
              </div>
              <div>
                <dt>今日上传量</dt>
                <dd>{{ formatBytes(site.todayUploaded) }}</dd>
              </div>
            </dl>
            <p>凭证：{{ credentialLabel(site) }}</p>
            <p>签到：{{ signinStatusMeta(site).label }}<span v-if="site.signinEnabled">（{{ site.signinTime }}）</span></p>
            <p>最近成功：{{ formatDate(site.lastConnectedAt) }}</p>
            <p v-if="site.lastConnectError">错误：{{ site.lastConnectError }}</p>
            <div class="row-actions">
              <button type="button" :disabled="site.signinRunning" :aria-busy="site.signinRunning" @click="triggerSignin(site)">{{ site.signinRunning ? '签到中...' : '签到' }}</button>
              <button type="button" @click="testSite(site)">测试</button>
              <button type="button" @click="openBrowse(site)">浏览</button>
              <button type="button" @click="openEdit(site)">编辑</button>
              <button class="danger-text" type="button" @click="removeSite(site)">删除</button>
            </div>
          </article>
        </div>
      </section>
    </section>

    <div v-if="formVisible" class="modal-backdrop" @click.self="closeForm">
      <form class="site-form" @submit.prevent="saveSite">
        <div class="form-head">
          <div>
            <h2>{{ editingSiteId ? '编辑站点' : '新增站点' }}</h2>
            <p>保存后会自动执行站点检查和用户统计获取。</p>
          </div>
          <button type="button" @click="closeForm">×</button>
        </div>

        <div class="form-grid compact-form-grid">
          <section>
            <h3>基础信息</h3>
            <label>站点域名<input v-model.trim="form.domain" required placeholder="pt.m-team.cc" /></label>
            <label class="inline-check"><input v-model="form.enabled" type="checkbox" /> 启用站点</label>
          </section>

          <section>
            <h3>访问凭证</h3>
            <label>
              API Key
              <div class="password-input">
                <input
                  v-model.trim="form.apiKey"
                  :type="apiKeyVisible ? 'text' : 'password'"
                  :placeholder="editingSiteId && detailHasApiKey && !form.apiKey ? '已保存，留空不修改' : ''"
                />
                <button type="button" :disabled="saving" @click="apiKeyVisible = !apiKeyVisible">
                  {{ apiKeyVisible ? '隐藏' : '显示' }}
                </button>
              </div>
            </label>
            <label>
              Cookie
              <div class="password-input">
                <input
                  v-model.trim="form.cookie"
                  :type="cookieVisible ? 'text' : 'password'"
                  :placeholder="editingSiteId && detailHasCookie && !form.cookie ? '已保存，留空不修改' : ''"
                />
                <button type="button" :disabled="saving" @click="cookieVisible = !cookieVisible">
                  {{ cookieVisible ? '隐藏' : '显示' }}
                </button>
              </div>
            </label>
            <label>
              User-Agent
              <div class="ua-row">
                <input v-model.trim="form.userAgent" placeholder="当前浏览器 User-Agent" />
                <button type="button" @click="restoreUserAgent">恢复当前浏览器</button>
              </div>
            </label>
          </section>

          <section>
            <h3>签到设置</h3>
            <label class="inline-check">
              <input v-model="form.signinEnabled" type="checkbox" /> 启用每日签到
            </label>
            <label v-if="form.signinEnabled">
              签到时间
              <input v-model.trim="form.signinTime" placeholder="HH:mm，例如 09:00" pattern="^([01]\d|2[0-3]):[0-5]\d$" required />
            </label>
            <p v-if="!form.signinEnabled" class="form-hint">开启后调度器会按签到时间自动签到；列表【签到】按钮始终可用。</p>
            <p v-else class="form-hint">时间采用 24 小时制 HH:mm；签到结果将记录到【日志 &gt; 签到日志】。</p>
          </section>
        </div>

        <div class="form-foot">
          <span>校验：域名合法，API Key 和 Cookie 至少填写一个。已知域名自动显示站点显示名。</span>
          <button type="button" class="secondary-button" @click="closeForm">取消</button>
          <button class="primary-button compact" :disabled="saving" type="submit">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </form>
    </div>

    <div v-if="browseVisible" class="modal-backdrop" @click.self="closeBrowse">
      <section class="browse-dialog">
        <div class="browse-head">
          <h2>浏览 - {{ browsingSite?.displayName }}</h2>
          <button type="button" @click="closeBrowse">×</button>
        </div>
        <div class="browse-toolbar">
          <input v-model.trim="browseFilters.keyword" placeholder="搜索关键字" @keyup.enter="loadBrowseTorrents" />
          <select v-model="browseFilters.category">
            <option value="">资源分类</option>
          </select>
          <button class="primary-button compact" type="button" :disabled="browseLoading" @click="loadBrowseTorrents">
            {{ browseLoading ? '搜索中...' : '搜索' }}
          </button>
        </div>
        <div class="browse-meta">
          <span>{{ browseError || `共 ${browseTotal} 条结果` }}</span>
          <span>{{ browseFilters.pageSize }}</span>
        </div>
        <div class="browse-table">
          <div class="browse-row browse-row-head">
            <span>标题</span>
            <span>时间</span>
            <span>大小</span>
            <span>做种</span>
            <span>下载</span>
          </div>
          <div v-if="!browseItems.length && !browseLoading" class="browse-empty">{{ browseError ? '获取失败' : '暂无结果' }}</div>
          <div v-for="torrent in browseItems" :key="torrent.id" class="browse-row">
            <div>
              <strong>{{ torrent.title }}</strong>
              <small>{{ torrent.subtitle || '-' }}</small>
              <div class="torrent-tags">
                <span v-for="tag in torrent.tags" :key="tag">{{ tag }}</span>
              </div>
            </div>
            <span>{{ formatBrowseDate(torrent.createdAt) }}</span>
            <span>{{ formatBytes(torrent.size) }}</span>
            <span>{{ torrent.seeders ?? '-' }}</span>
            <span>{{ torrent.leechers ?? '-' }}</span>
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import {
  browseSiteTorrents,
  createSite,
  deleteSite,
  getSite,
  getSites,
  testSiteConnectivity,
  triggerSiteSignin,
  updateSite,
  type BrowseTorrentItem,
  type SiteFilter,
  type SiteFormPayload,
  type SiteListItem,
  type SiteStats
} from '../api/sites'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const items = ref<SiteListItem[]>([])
const stats = ref<SiteStats>({ total: 0, online: 0, authFailed: 0, offline: 0, unknown: 0 })
const formVisible = ref(false)
const editingSiteId = ref<string>()
const detailHasApiKey = ref(false)
const detailHasCookie = ref(false)
const apiKeyVisible = ref(false)
const cookieVisible = ref(false)
const originalApiKey = ref('')
const originalCookie = ref('')
const browseVisible = ref(false)
const browseLoading = ref(false)
const browseError = ref('')
const browsingSite = ref<SiteListItem>()
const browseItems = ref<BrowseTorrentItem[]>([])
const browseTotal = ref(0)

const filters = reactive<Required<Omit<SiteFilter, 'page' | 'pageSize'>>>({
  keyword: typeof route.query.keyword === 'string' ? route.query.keyword : '',
  connectivityStatus: typeof route.query.connectivityStatus === 'string' ? (route.query.connectivityStatus as SiteFilter['connectivityStatus']) ?? 'ALL' : 'ALL',
  enabled: typeof route.query.enabled === 'string' ? (route.query.enabled as SiteFilter['enabled']) ?? 'ALL' : 'ALL',
  signinEnabled: typeof route.query.signinEnabled === 'string' ? (route.query.signinEnabled as SiteFilter['signinEnabled']) ?? 'ALL' : 'ALL'
})

const form = reactive<SiteFormPayload>({
  domain: '',
  enabled: true,
  apiKey: '',
  cookie: '',
  userAgent: '',
  signinEnabled: false,
  signinTime: '09:00'
})

const browseFilters = reactive({
  keyword: '',
  category: '',
  page: 1,
  pageSize: 100
})

const hasFilters = computed(() => Boolean(filters.keyword || filters.connectivityStatus !== 'ALL' || filters.enabled !== 'ALL' || filters.signinEnabled !== 'ALL'))
const statCards = computed(() => [
  { label: '全部站点', value: stats.value.total, className: '' },
  { label: '在线站点', value: stats.value.online, className: 'success' },
  { label: '认证失败', value: stats.value.authFailed, className: 'warning' },
  { label: '离线站点', value: stats.value.offline, className: 'danger' },
  { label: '未知状态', value: stats.value.unknown, className: '' }
])

function resetForm() {
  editingSiteId.value = undefined
  detailHasApiKey.value = false
  detailHasCookie.value = false
  apiKeyVisible.value = false
  cookieVisible.value = false
  originalApiKey.value = ''
  originalCookie.value = ''
  Object.assign(form, {
    domain: '',
    enabled: true,
    apiKey: '',
    cookie: '',
    userAgent: navigator.userAgent,
    signinEnabled: false,
    signinTime: '09:00'
  })
}

function statusMeta(status: SiteListItem['connectivityStatus']) {
  const map = {
    ONLINE: { label: '在线', className: 'online-chip' },
    OFFLINE: { label: '离线', className: 'offline-chip' },
    AUTH_FAILED: { label: '认证失败', className: 'auth-chip' },
    UNKNOWN: { label: '未检测', className: 'unknown-chip' }
  }
  return map[status]
}

function credentialLabel(site: SiteListItem) {
  if (site.currentCredential === 'API_KEY') return 'API Key'
  if (site.currentCredential === 'COOKIE') return 'Cookie'
  if (site.hasApiKey) return 'API Key'
  if (site.hasCookie) return 'Cookie'
  return '无可用凭证'
}

function signinStatusMeta(site: SiteListItem) {
  if (!site.signinEnabled) {
    return { label: '已关闭', className: 'muted-chip' }
  }
  if (site.signinRunning) {
    return { label: '签到中...', className: 'unknown-chip' }
  }
  if (site.todaySigninStatus === 'SUCCESS') {
    return { label: '已签到', className: 'online-chip' }
  }
  if (site.todaySigninStatus === 'FAILED') {
    return { label: '签到失败', className: 'auth-chip' }
  }
  if (site.todaySigninStatus === 'SKIPPED') {
    return { label: '已跳过', className: 'unknown-chip' }
  }
  return { label: '待签到', className: 'unknown-chip' }
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatBrowseDate(value?: string) {
  if (!value) return '-'
  return new Date(value.replace(' ', 'T')).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatRatio(site: SiteListItem) {
  if (site.ratioInfinite) return '∞'
  if (site.ratio === undefined) return '-'
  return site.ratio.toFixed(2)
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
  const maximumFractionDigits = unitIndex === 0 ? 0 : 2
  const formatted = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(size)
  return `${formatted} ${units[unitIndex]}`
}

function restoreUserAgent() {
  form.userAgent = navigator.userAgent
}

function closeForm() {
  formVisible.value = false
}

function closeBrowse() {
  browseVisible.value = false
}

async function loadSites() {
  loading.value = true
  error.value = ''
  try {
    const result = await getSites({ ...filters, page: 1, pageSize: 50 })
    items.value = result.items
    stats.value = result.stats
    await router.replace({
      query: {
        keyword: filters.keyword || undefined,
        connectivityStatus: filters.connectivityStatus === 'ALL' ? undefined : filters.connectivityStatus,
        enabled: filters.enabled === 'ALL' ? undefined : filters.enabled,
        signinEnabled: filters.signinEnabled === 'ALL' ? undefined : filters.signinEnabled
      }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '站点列表加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openEdit(site: SiteListItem) {
  resetForm()
  const detail = await getSite(site.id)
  editingSiteId.value = detail.id
  detailHasApiKey.value = detail.hasApiKey
  detailHasCookie.value = detail.hasCookie
  Object.assign(form, {
    domain: detail.domain,
    enabled: detail.enabled,
    apiKey: detail.apiKey || '',
    cookie: detail.cookie || '',
    userAgent: detail.userAgent || navigator.userAgent,
    signinEnabled: detail.signinEnabled,
    signinTime: detail.signinTime || '09:00'
  })
  originalApiKey.value = detail.apiKey || ''
  originalCookie.value = detail.cookie || ''
  formVisible.value = true
}

function validateForm() {
  if (!form.domain.trim()) return '站点域名不能为空'
  try {
    new URL(form.domain.includes('://') ? form.domain : `https://${form.domain}`)
  } catch {
    return '站点域名必须是合法域名或 URL'
  }
  if (!form.apiKey?.trim() && !form.cookie?.trim() && !detailHasApiKey.value && !detailHasCookie.value) return 'API Key 和 Cookie 至少填写一个'
  if (form.signinEnabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.signinTime?.trim() ?? '')) return '签到时间必须是 HH:mm 格式'
  return ''
}

function buildSitePayload(): SiteFormPayload {
  return {
    domain: form.domain.trim(),
    enabled: form.enabled,
    apiKey: editingSiteId.value && form.apiKey === originalApiKey.value ? originalApiKey.value || undefined : form.apiKey?.trim() || undefined,
    cookie: editingSiteId.value && form.cookie === originalCookie.value ? originalCookie.value || undefined : form.cookie?.trim() || undefined,
    userAgent: form.userAgent?.trim() || undefined,
    signinEnabled: form.signinEnabled,
    signinTime: form.signinEnabled ? (form.signinTime?.trim() || '09:00') : (form.signinTime?.trim() || '09:00')
  }
}

async function saveSite() {
  const validation = validateForm()
  if (validation) {
    Snackbar.warning(validation)
    return
  }

  saving.value = true
  try {
    const payload = buildSitePayload()
    const saved = editingSiteId.value ? await updateSite(editingSiteId.value, payload) : await createSite(payload)
    try {
      const result = await testSiteConnectivity(saved.id)
      Snackbar[result.ok ? 'success' : 'error'](result.ok ? `测试成功，当前使用${result.credential === 'COOKIE' ? 'Cookie' : 'API Key'}` : result.errorMessage || '测试失败')
    } catch (testError) {
      Snackbar.error(`站点已保存，测试失败：${testError instanceof Error ? testError.message : '测试失败'}`)
    }
    formVisible.value = false
    await loadSites()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function testSite(site: SiteListItem) {
  try {
    const result = await testSiteConnectivity(site.id)
    Snackbar.success(`测试成功，当前使用${result.credential === 'COOKIE' ? 'Cookie' : 'API Key'}`)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试失败')
  }
  await loadSites()
}

async function triggerSignin(site: SiteListItem) {
  if (site.signinRunning) {
    Snackbar.warning('该站点签到正在执行中')
    return
  }
  const target = items.value.find((item) => item.id === site.id)
  if (target) target.signinRunning = true
  try {
    const result = await triggerSiteSignin(site.id)
    if (result.status === 'SUCCESS') {
      Snackbar.success(result.message)
    } else if (result.status === 'SKIPPED') {
      Snackbar.warning(result.message)
    } else {
      Snackbar.error(result.errorMessage || result.message || '签到失败')
    }
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '签到失败')
  } finally {
    await loadSites()
  }
}

async function openBrowse(site: SiteListItem) {
  browsingSite.value = site
  browseVisible.value = true
  browseItems.value = []
  browseTotal.value = 0
  browseError.value = ''
  browseFilters.keyword = ''
  browseFilters.category = ''
  browseFilters.page = 1
  await loadBrowseTorrents()
}

async function loadBrowseTorrents() {
  if (!browsingSite.value) return
  browseLoading.value = true
  browseError.value = ''
  try {
    const result = await browseSiteTorrents(browsingSite.value.id, { ...browseFilters })
    browseItems.value = result.items
    browseTotal.value = result.total
  } catch (err) {
    browseError.value = err instanceof Error ? err.message : '种子列表获取失败'
    browseItems.value = []
    browseTotal.value = 0
  } finally {
    browseLoading.value = false
  }
}

async function removeSite(site: SiteListItem) {
  if (!window.confirm(`确认删除站点「${site.displayName}」？`)) return
  await deleteSite(site.id)
  Snackbar.success('站点已删除')
  await loadSites()
}

function resetFilters() {
  filters.keyword = ''
  filters.connectivityStatus = 'ALL'
  filters.enabled = 'ALL'
  filters.signinEnabled = 'ALL'
  loadSites()
}

onMounted(async () => {
  if (route.query.action === 'create') openCreate()
  await loadSites()
})
</script>
