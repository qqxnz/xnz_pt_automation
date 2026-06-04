<template>
  <AppLayout>
    <section class="sites-page">
      <div class="dashboard-head">
        <div>
          <h1>站点</h1>
          <p>管理 PT 站点访问凭证、User-Agent、代理和连通状态</p>
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
        <input v-model.trim="filters.keyword" placeholder="搜索站点 / MTeam" @keyup.enter="loadSites" />
        <select v-model="filters.connectivityStatus" @change="loadSites">
          <option value="ALL">状态：全部</option>
          <option value="ONLINE">在线</option>
          <option value="AUTH_FAILED">认证失败</option>
          <option value="OFFLINE">离线</option>
          <option value="UNKNOWN">未检测</option>
        </select>
        <select v-model="filters.proxyUsage" @change="loadSites">
          <option value="ALL">代理：全部</option>
          <option value="NONE">不使用代理</option>
          <option value="ENABLED">已选择代理</option>
        </select>
        <select v-model="filters.enabled" @change="loadSites">
          <option value="ALL">启用：全部</option>
          <option value="ENABLED">已启用</option>
          <option value="DISABLED">已禁用</option>
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
            <span>站点名称</span>
            <span>启用</span>
            <span>连通状态</span>
            <span>当前凭证</span>
            <span>代理</span>
            <span>最近成功</span>
            <span>操作</span>
          </div>
          <div v-for="site in items" :key="site.id" class="site-row">
            <div>
              <strong>{{ site.name }}</strong>
              <small>{{ site.baseUrl }}</small>
            </div>
            <button class="switch" :class="{ on: site.enabled }" type="button" @click="toggleSite(site)" aria-label="切换站点启用状态">
              <span />
            </button>
            <span class="chip" :class="statusMeta(site.connectivityStatus).className">{{ statusMeta(site.connectivityStatus).label }}</span>
            <span class="chip muted-chip">{{ accessLabel(site) }}</span>
            <span class="chip" :class="site.proxyName ? 'proxy-chip' : 'muted-chip'">{{ site.proxyName ?? '不使用代理' }}</span>
            <span>{{ formatDate(site.lastConnectedAt) }}</span>
            <div class="row-actions">
              <button type="button" @click="testSite(site)">测试</button>
              <button type="button" @click="openEdit(site)">编辑</button>
              <button type="button" @click="syncTorrents(site)">同步种子</button>
              <button type="button" @click="syncTraffic(site)">同步流量</button>
              <button class="danger-text" type="button" @click="removeSite(site)">删除</button>
            </div>
          </div>
        </div>

        <div class="mobile-site-list">
          <article v-for="site in items" :key="site.id" class="site-card">
            <div>
              <strong>{{ site.name }}</strong>
              <span class="chip" :class="statusMeta(site.connectivityStatus).className">{{ statusMeta(site.connectivityStatus).label }}</span>
            </div>
            <p>凭证：{{ accessLabel(site) }}</p>
            <p>代理：{{ site.proxyName ?? '不使用代理' }}</p>
            <p>最近成功：{{ formatDate(site.lastConnectedAt) }}</p>
            <p v-if="site.lastConnectError">错误：{{ site.lastConnectError }}</p>
            <div class="row-actions">
              <button type="button" @click="testSite(site)">测试</button>
              <button type="button" @click="openEdit(site)">编辑</button>
              <button type="button" @click="syncTorrents(site)">更多</button>
            </div>
          </article>
        </div>
      </section>
    </section>

    <div v-if="formVisible" class="modal-backdrop" @click.self="closeForm">
      <form class="site-form" @submit.prevent="saveSite(false)">
        <div class="form-head">
          <div>
            <h2>{{ editingSiteId ? '编辑站点' : '新增站点' }}</h2>
            <p>保存并测试会先保存配置，再执行连通性检测。</p>
          </div>
          <button type="button" @click="closeForm">×</button>
        </div>

        <div class="form-grid">
          <section>
            <h3>基础信息</h3>
            <label>站点名称<input v-model.trim="form.name" required /></label>
            <label>站点地址<input v-model.trim="form.baseUrl" required placeholder="https://example.com" /></label>
            <label>解析类型<input v-model="form.parserType" disabled /></label>
            <label class="inline-check"><input v-model="form.enabled" type="checkbox" /> 启用站点</label>
          </section>

          <section>
            <h3>访问凭证</h3>
            <label>站点密钥<input v-model.trim="form.accessKey" :placeholder="editingSiteId && detailHasAccessKey ? '已保存，留空不修改' : ''" /></label>
            <label>Cookie<input v-model.trim="form.cookie" :placeholder="editingSiteId && detailHasCookie ? '已保存，留空不修改' : ''" /></label>
            <label>
              User-Agent
              <div class="ua-row">
                <input v-model.trim="form.userAgent" placeholder="当前浏览器 User-Agent" />
                <button type="button" @click="restoreUserAgent">恢复当前浏览器</button>
              </div>
            </label>
          </section>

          <section>
            <h3>抓取配置</h3>
            <label>种子地址<input v-model.trim="form.freeTorrentUrl" required /></label>
            <label>个人信息地址<input v-model.trim="form.profileUrl" placeholder="/userdetails.php?id=..." /></label>
            <label>检查间隔<input v-model.number="form.checkIntervalMinutes" min="5" type="number" required /></label>
          </section>

          <section>
            <h3>代理配置</h3>
            <label>
              使用代理
              <select v-model="form.proxyId">
                <option value="">不使用代理</option>
                <option v-for="proxy in enabledProxies" :key="proxy.id" :value="proxy.id">
                  {{ proxy.name }} · {{ proxy.type }}
                </option>
              </select>
            </label>
            <div class="empty-tip compact-tip">代理配置来自代理管理模块。默认不使用代理。</div>
          </section>
        </div>

        <div class="form-foot">
          <span>校验：名称必填、URL 合法、密钥和 Cookie 至少一个、检查间隔不少于 5 分钟。</span>
          <button type="button" class="secondary-button" @click="closeForm">取消</button>
          <button type="button" class="secondary-button blue" :disabled="saving" @click="saveSite(true)">保存并测试</button>
          <button class="primary-button compact" :disabled="saving" type="submit">{{ saving ? '保存中...' : '保存' }}</button>
        </div>
      </form>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'
import {
  createSite,
  deleteSite,
  getProxies,
  getSite,
  getSites,
  syncSiteTorrents,
  syncSiteTraffic,
  testSiteConnectivity,
  updateSite,
  type ProxyOption,
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
const proxies = ref<ProxyOption[]>([])
const formVisible = ref(false)
const editingSiteId = ref<string>()
const detailHasAccessKey = ref(false)
const detailHasCookie = ref(false)

const filters = reactive<Required<Omit<SiteFilter, 'page' | 'pageSize'>>>({
  keyword: typeof route.query.keyword === 'string' ? route.query.keyword : '',
  connectivityStatus: typeof route.query.connectivityStatus === 'string' ? (route.query.connectivityStatus as SiteFilter['connectivityStatus']) ?? 'ALL' : 'ALL',
  proxyUsage: typeof route.query.proxyUsage === 'string' ? (route.query.proxyUsage as SiteFilter['proxyUsage']) ?? 'ALL' : 'ALL',
  enabled: typeof route.query.enabled === 'string' ? (route.query.enabled as SiteFilter['enabled']) ?? 'ALL' : 'ALL'
})

const form = reactive<SiteFormPayload>({
  name: '',
  baseUrl: '',
  enabled: true,
  accessKey: '',
  cookie: '',
  userAgent: '',
  parserType: 'NEXUSPHP',
  freeTorrentUrl: '/torrents.php?spstate=2',
  profileUrl: '',
  proxyId: '',
  checkIntervalMinutes: 30
})

const enabledProxies = computed(() => proxies.value.filter((proxy) => proxy.enabled))
const hasFilters = computed(() => Boolean(filters.keyword || filters.connectivityStatus !== 'ALL' || filters.proxyUsage !== 'ALL' || filters.enabled !== 'ALL'))
const statCards = computed(() => [
  { label: '全部站点', value: stats.value.total, className: '' },
  { label: '在线站点', value: stats.value.online, className: 'success' },
  { label: '认证失败', value: stats.value.authFailed, className: 'warning' },
  { label: '离线站点', value: stats.value.offline, className: 'danger' },
  { label: '未知状态', value: stats.value.unknown, className: '' }
])

function resetForm() {
  editingSiteId.value = undefined
  detailHasAccessKey.value = false
  detailHasCookie.value = false
  Object.assign(form, {
    name: '',
    baseUrl: '',
    enabled: true,
    accessKey: '',
    cookie: '',
    userAgent: navigator.userAgent,
    parserType: 'NEXUSPHP',
    freeTorrentUrl: '/torrents.php?spstate=2',
    profileUrl: '',
    proxyId: '',
    checkIntervalMinutes: 30
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

function accessLabel(site: SiteListItem) {
  if (site.currentAccessMethod === 'ACCESS_KEY') return '密钥'
  if (site.currentAccessMethod === 'COOKIE') return 'Cookie'
  if (site.hasAccessKey) return '密钥'
  if (site.hasCookie) return 'Cookie'
  return '无可用凭证'
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function restoreUserAgent() {
  form.userAgent = navigator.userAgent
}

function closeForm() {
  formVisible.value = false
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
        proxyUsage: filters.proxyUsage === 'ALL' ? undefined : filters.proxyUsage,
        enabled: filters.enabled === 'ALL' ? undefined : filters.enabled
      }
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : '站点列表加载失败'
  } finally {
    loading.value = false
  }
}

async function loadProxies() {
  const result = await getProxies().catch(() => ({ items: [] }))
  proxies.value = result.items
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openEdit(site: SiteListItem) {
  resetForm()
  const detail = await getSite(site.id)
  editingSiteId.value = detail.id
  detailHasAccessKey.value = detail.hasAccessKey
  detailHasCookie.value = detail.hasCookie
  Object.assign(form, {
    name: detail.name,
    baseUrl: detail.baseUrl,
    enabled: detail.enabled,
    accessKey: '',
    cookie: '',
    userAgent: detail.userAgent || navigator.userAgent,
    parserType: 'NEXUSPHP',
    freeTorrentUrl: detail.freeTorrentUrl,
    profileUrl: detail.profileUrl || '',
    proxyId: detail.proxyId || '',
    checkIntervalMinutes: detail.checkIntervalMinutes
  })
  formVisible.value = true
}

function validateForm() {
  if (!form.name.trim()) return '站点名称不能为空'
  if (!form.baseUrl.trim()) return '站点地址不能为空'
  try {
    new URL(form.baseUrl)
  } catch {
    return '站点地址必须是合法 URL'
  }
  if (!form.accessKey?.trim() && !form.cookie?.trim() && !detailHasAccessKey.value && !detailHasCookie.value) return '站点密钥和 Cookie 至少填写一个'
  if (form.checkIntervalMinutes < 5) return '检查间隔不能少于 5 分钟'
  return ''
}

async function saveSite(runTest: boolean) {
  const validation = validateForm()
  if (validation) {
    Snackbar.warning(validation)
    return
  }

  saving.value = true
  try {
    const payload = { ...form, proxyId: form.proxyId || undefined, profileUrl: form.profileUrl || undefined }
    const saved = editingSiteId.value ? await updateSite(editingSiteId.value, payload) : await createSite(payload)
    if (runTest) {
      const result = await testSiteConnectivity(saved.id)
      Snackbar[result.ok ? 'success' : 'error'](result.ok ? `连接成功，当前使用${result.accessMethod === 'COOKIE' ? 'Cookie' : '密钥'}访问` : result.errorMessage || '连接失败')
    } else {
      Snackbar.success('站点已保存')
    }
    formVisible.value = false
    await loadSites()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    saving.value = false
  }
}

async function toggleSite(site: SiteListItem) {
  const detail = await getSite(site.id)
  await updateSite(site.id, {
    name: detail.name,
    baseUrl: detail.baseUrl,
    enabled: !detail.enabled,
    parserType: 'NEXUSPHP',
    freeTorrentUrl: detail.freeTorrentUrl,
    profileUrl: detail.profileUrl,
    userAgent: detail.userAgent,
    proxyId: detail.proxyId,
    checkIntervalMinutes: detail.checkIntervalMinutes
  })
  await loadSites()
}

async function testSite(site: SiteListItem) {
  const result = await testSiteConnectivity(site.id)
  Snackbar[result.ok ? 'success' : 'error'](result.ok ? `连接成功，当前使用${result.accessMethod === 'COOKIE' ? 'Cookie' : '密钥'}访问` : result.errorMessage || '连接失败')
  await loadSites()
}

async function syncTorrents(site: SiteListItem) {
  const result = await syncSiteTorrents(site.id)
  Snackbar.success(result.message)
}

async function syncTraffic(site: SiteListItem) {
  const result = await syncSiteTraffic(site.id)
  Snackbar.success(result.message)
}

async function removeSite(site: SiteListItem) {
  if (!window.confirm(`确认删除站点「${site.name}」？`)) return
  await deleteSite(site.id)
  Snackbar.success('站点已删除')
  await loadSites()
}

function resetFilters() {
  filters.keyword = ''
  filters.connectivityStatus = 'ALL'
  filters.proxyUsage = 'ALL'
  filters.enabled = 'ALL'
  loadSites()
}

onMounted(async () => {
  if (route.query.action === 'create') openCreate()
  await Promise.all([loadSites(), loadProxies()])
})
</script>
