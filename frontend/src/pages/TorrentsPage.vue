<template>
  <AppLayout>
    <section class="feature-page">
      <div class="dashboard-head">
        <div>
          <h1>种子</h1>
          <p>只展示自动执行和手动运行写入的种子；测试结果不会进入列表。</p>
        </div>
        <button class="primary-button compact" type="button" :disabled="!selectedIds.length" @click="batchPush">
          批量推送
        </button>
      </div>

      <section class="site-stats">
        <article v-for="card in statCards" :key="card.label" class="metric-card">
          <span>{{ card.label }}</span>
          <strong :class="card.className">{{ card.value }}</strong>
        </article>
      </section>

      <section class="sites-toolbar panel">
        <input v-model.trim="filters.keyword" placeholder="搜索标题 / 站点 / 任务" @keyup.enter="loadTorrents" />
        <select v-model="filters.sourceRunMode" @change="loadTorrents">
          <option value="ALL">来源：全部</option>
          <option value="AUTO">自动执行</option>
          <option value="MANUAL_RUN">手动运行</option>
        </select>
        <select v-model="filters.pushStatus" @change="loadTorrents">
          <option value="ALL">推送：全部</option>
          <option value="NEW">待推送</option>
          <option value="PUSHED">已推送</option>
          <option value="PUSH_FAILED">推送失败</option>
          <option value="DELETED">已删除</option>
        </select>
        <button class="secondary-button" type="button" :disabled="loading" @click="loadTorrents">{{ loading ? '刷新中...' : '刷新' }}</button>
      </section>

      <section class="panel">
        <div class="panel-title-row">
          <h2>种子列表</h2>
          <span>已选 {{ selectedIds.length }} 个 · 共 {{ total }} 个</span>
        </div>
        <div v-if="error" class="error-banner">{{ error }}<button type="button" @click="loadTorrents">重试</button></div>
        <div v-if="!items.length && !loading" class="sites-empty">
          <h2>暂无种子记录</h2>
          <p>运行任务后，自动执行或手动运行产生的种子会出现在这里。</p>
          <router-link class="primary-button compact" to="/tasks">去运行任务</router-link>
        </div>
        <div v-else class="desktop-table torrent-table">
          <div class="torrent-row table-head">
            <span></span><span>种子</span><span>状态</span><span>来源</span><span>下载器</span><span>操作</span>
          </div>
          <div v-for="torrent in items" :key="torrent.id" class="torrent-row">
            <input v-model="selectedIds" type="checkbox" :value="torrent.id" :disabled="torrent.pushStatus !== 'NEW'" />
            <span>
              <strong>{{ torrent.title }}</strong>
              <small>{{ torrent.siteName }} · {{ formatBytes(torrent.size) }} · {{ discountText(torrent.discountType) }} · 链接{{ linkText(torrent.linkStatus) }}</small>
            </span>
            <span>
              <span class="chip" :class="pushClass(torrent.pushStatus)">{{ pushText(torrent.pushStatus) }}</span>
              <small>{{ torrent.errorMessage || freeText(torrent) }}</small>
            </span>
            <span>
              <strong>{{ runModeText(torrent.sourceRunMode) }}</strong>
              <small>{{ torrent.sourceTaskName || '-' }}</small>
            </span>
            <span>
              <strong>{{ torrent.downloaderName || '-' }}</strong>
              <small>{{ torrent.torrentHash ? `Hash ${torrent.torrentHash.slice(0, 8)}` : torrent.downloaderState || '-' }}</small>
            </span>
            <span class="row-actions">
              <button type="button" :disabled="torrent.pushStatus === 'PUSHED'" @click="pushOne(torrent)">推送</button>
              <button type="button" @click="showDetail(torrent)">详情</button>
              <button v-if="torrent.pushStatus === 'PUSHED'" class="danger-text" type="button" @click="deleteFromDownloader(torrent)">删除任务</button>
            </span>
          </div>
        </div>
        <div class="pager">
          <button type="button" :disabled="filters.page <= 1 || loading" @click="changePage(filters.page - 1)">上一页</button>
          <span>第 {{ filters.page }} / {{ totalPages }} 页</span>
          <button type="button" :disabled="filters.page >= totalPages || loading" @click="changePage(filters.page + 1)">下一页</button>
        </div>
      </section>
    </section>

    <div v-if="detail" class="modal-backdrop">
      <section class="site-form test-result-dialog">
        <div class="form-head">
          <div>
            <h2>种子详情</h2>
            <p>{{ detail.siteName }} · {{ runModeText(detail.sourceRunMode) }} · {{ detail.sourceTaskName || '-' }}</p>
          </div>
          <button type="button" @click="detail = undefined">×</button>
        </div>
        <div class="test-result-list">
          <article><strong>{{ detail.title }}</strong><span>{{ formatBytes(detail.size) }} · {{ discountText(detail.discountType) }}</span></article>
          <article><strong>推送状态</strong><span>{{ pushText(detail.pushStatus) }} · {{ detail.downloaderName || '-' }}</span></article>
          <article><strong>种链接状态</strong><span>{{ linkText(detail.linkStatus) }}</span></article>
          <article v-if="detail.errorMessage"><strong>失败原因</strong><span>{{ detail.errorMessage }}</span></article>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onMounted, reactive, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import {
  batchPushTorrents,
  deleteTorrentFromDownloader,
  getTorrents,
  pushTorrent,
  type TorrentFilter,
  type TorrentItem,
  type TorrentStats
} from '../api/torrents'

const items = ref<TorrentItem[]>([])
const selectedIds = ref<string[]>([])
const detail = ref<TorrentItem>()
const total = ref(0)
const loading = ref(false)
const error = ref('')
const stats = ref<TorrentStats>({ total: 0, auto: 0, manual: 0, pending: 0, failed: 0, expiringSoon: 0 })
const filters = reactive<Required<Pick<TorrentFilter, 'keyword' | 'pushStatus' | 'sourceRunMode' | 'page' | 'pageSize'>>>({
  keyword: '',
  pushStatus: 'ALL',
  sourceRunMode: 'ALL',
  page: 1,
  pageSize: 20
})

const totalPages = computed(() => Math.max(Math.ceil(total.value / filters.pageSize), 1))
const statCards = computed(() => [
  { label: '全部种子', value: stats.value.total, className: '' },
  { label: '自动执行', value: stats.value.auto, className: 'success' },
  { label: '手动运行', value: stats.value.manual, className: 'warning' },
  { label: '待推送', value: stats.value.pending, className: '' },
  { label: '推送失败', value: stats.value.failed, className: 'danger' }
])

async function loadTorrents() {
  loading.value = true
  error.value = ''
  try {
    const result = await getTorrents(filters)
    items.value = result.items
    total.value = result.total
    stats.value = result.stats
    selectedIds.value = selectedIds.value.filter((id) => result.items.some((item) => item.id === id && item.pushStatus === 'NEW'))
  } catch (err) {
    error.value = err instanceof Error ? err.message : '种子列表加载失败'
  } finally {
    loading.value = false
  }
}

function changePage(page: number) {
  filters.page = Math.min(Math.max(page, 1), totalPages.value)
  loadTorrents()
}

async function pushOne(torrent: TorrentItem) {
  try {
    await pushTorrent(torrent.id)
    Snackbar.success('种子已推送')
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '推送失败')
  }
}

async function batchPush() {
  const result = await batchPushTorrents(selectedIds.value)
  Snackbar[result.failedCount ? 'warning' : 'success'](`成功 ${result.successCount} 个，失败 ${result.failedCount} 个`)
  selectedIds.value = []
  await loadTorrents()
}

async function deleteFromDownloader(torrent: TorrentItem) {
  if (!window.confirm(`确认删除下载器任务「${torrent.title}」？`)) return
  await deleteTorrentFromDownloader(torrent.id)
  Snackbar.success('下载器任务已删除')
  await loadTorrents()
}

function showDetail(torrent: TorrentItem) {
  detail.value = torrent
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

function discountText(value: TorrentItem['discountType']) {
  return value === 'TWO_X_FREE' ? '2X FREE' : value === 'HALF_FREE' ? 'HALF FREE' : value
}

function runModeText(value: TorrentItem['sourceRunMode']) {
  return value === 'AUTO' ? '自动执行' : '手动运行'
}

function linkText(value: TorrentItem['linkStatus']) {
  return value === 'SAVED' ? '已保存' : value === 'MISSING' ? '缺失' : '失效'
}

function pushText(value: TorrentItem['pushStatus']) {
  const map = { NEW: '待推送', PUSHED: '已推送', PUSH_FAILED: '推送失败', DELETED: '已删除' }
  return map[value]
}

function pushClass(value: TorrentItem['pushStatus']) {
  if (value === 'PUSHED') return 'online-chip'
  if (value === 'PUSH_FAILED') return 'offline-chip'
  if (value === 'DELETED') return 'muted-chip'
  return 'pending-chip'
}

function freeText(torrent: TorrentItem) {
  if (!torrent.freeEndAt) return torrent.isFreeNow ? '免费中' : '非免费'
  return `免费至 ${new Date(torrent.freeEndAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
}

onMounted(loadTorrents)
</script>
