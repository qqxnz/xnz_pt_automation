<template>
  <AppLayout>
    <section class="feature-page">
      <div class="dashboard-head">
        <div>
          <h1>种子</h1>
          <p>只展示自动执行和手动运行写入的种子；测试结果不会进入列表。</p>
        </div>
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
          <div class="torrent-select-summary">
            <button class="text-button select-all-button" type="button" :disabled="!items.length || loading" @click="toggleSelectCurrentPage">
              {{ isCurrentPageAllSelected ? '取消全选' : '全选当前页' }}
            </button>
            <span>已选 {{ selectedIds.length }} 个 · 共 {{ total }} 个</span>
          </div>
        </div>
        <div v-if="error" class="error-banner">{{ error }}<button type="button" @click="loadTorrents">重试</button></div>
        <div v-if="!items.length && !loading" class="sites-empty">
          <h2>暂无种子记录</h2>
          <p>运行任务后，自动执行或手动运行产生的种子会出现在这里。</p>
          <router-link class="primary-button compact" to="/tasks">去运行任务</router-link>
        </div>
        <div v-else class="desktop-table torrent-table">
          <div class="torrent-row table-head">
            <span>
              <input
                type="checkbox"
                title="全选当前页"
                :checked="isCurrentPageAllSelected"
                :indeterminate="isCurrentPagePartiallySelected"
                :disabled="!items.length || loading"
                @change="setSelectCurrentPageFromEvent"
              />
            </span><span>种子</span><span>状态</span><span>来源</span><span>下载器</span><span>操作</span>
          </div>
          <div v-for="torrent in items" :key="torrent.id" class="torrent-row">
            <input v-model="selectedIds" type="checkbox" :value="torrent.id" />
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
              <button type="button" :disabled="!canPushTorrent(torrent)" @click="pushOne(torrent)">{{ isPushing(torrent.id) ? '推送中...' : '推送' }}</button>
              <button type="button" @click="showDetail(torrent)">详情</button>
              <button v-if="canDeleteFromDownloader(torrent)" class="danger-text" type="button" :disabled="isTorrentBusy(torrent.id)" @click="deleteFromDownloader(torrent)">{{ isDeleting(torrent.id) ? '删除中...' : '删除任务' }}</button>
            </span>
          </div>
        </div>

        <div class="mobile-torrent-list">
          <article v-for="torrent in items" :key="torrent.id" class="site-card torrent-card">
            <div>
              <label class="mobile-torrent-select">
                <input v-model="selectedIds" type="checkbox" :value="torrent.id" />
                <strong>{{ torrent.title }}</strong>
              </label>
              <span class="chip" :class="pushClass(torrent.pushStatus)">{{ pushText(torrent.pushStatus) }}</span>
            </div>
            <p>{{ torrent.siteName }} · {{ formatBytes(torrent.size) }} · {{ discountText(torrent.discountType) }}</p>
            <dl class="site-stat-grid">
              <div>
                <dt>来源</dt>
                <dd>{{ runModeText(torrent.sourceRunMode) }}</dd>
              </div>
              <div>
                <dt>任务</dt>
                <dd>{{ torrent.sourceTaskName || '-' }}</dd>
              </div>
              <div>
                <dt>下载器</dt>
                <dd>{{ torrent.downloaderName || '-' }}</dd>
              </div>
              <div>
                <dt>链接</dt>
                <dd>{{ linkText(torrent.linkStatus) }}</dd>
              </div>
            </dl>
            <p>{{ torrent.errorMessage || freeText(torrent) }}</p>
            <p v-if="torrent.torrentHash">Hash：{{ torrent.torrentHash.slice(0, 8) }}</p>
            <p v-else-if="torrent.downloaderState">下载器状态：{{ torrent.downloaderState }}</p>
            <div class="row-actions">
              <button type="button" :disabled="!canPushTorrent(torrent)" @click="pushOne(torrent)">{{ isPushing(torrent.id) ? '推送中...' : '推送' }}</button>
              <button type="button" @click="showDetail(torrent)">详情</button>
              <button v-if="canDeleteFromDownloader(torrent)" class="danger-text" type="button" :disabled="isTorrentBusy(torrent.id)" @click="deleteFromDownloader(torrent)">{{ isDeleting(torrent.id) ? '删除中...' : '删除任务' }}</button>
            </div>
          </article>
        </div>
        <div v-if="items.length" class="torrent-batch-bar">
          <span>已选 {{ selectedIds.length }} 个</span>
          <div>
            <button class="secondary-button blue" type="button" :disabled="!selectedPushableIds.length || batchPushing" @click="batchPush">
              {{ batchPushing ? '批量推送中...' : `批量推送${selectedPushableIds.length ? ` (${selectedPushableIds.length})` : ''}` }}
            </button>
            <button class="secondary-button danger-button" type="button" :disabled="!selectedIds.length || batchDeletingRecords" @click="batchDeleteRecords">
              {{ batchDeletingRecords ? '删除中...' : '删除记录' }}
            </button>
            <button class="secondary-button danger-button" type="button" :disabled="!selectedDeletableTaskIds.length || batchDeletingTasks" @click="batchDeleteTasks">
              {{ batchDeletingTasks ? '删除任务中...' : `删除任务${selectedDeletableTaskIds.length ? ` (${selectedDeletableTaskIds.length})` : ''}` }}
            </button>
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
          <article><strong>免费状态</strong><span>{{ freeText(detail) }} · {{ stateText(detail.currentState) }}</span></article>
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
  batchDeleteTorrentsFromDownloader,
  batchPushTorrents,
  deleteTorrentRecords,
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
const batchPushing = ref(false)
const batchDeletingRecords = ref(false)
const batchDeletingTasks = ref(false)
const pushingIds = ref<string[]>([])
const deletingIds = ref<string[]>([])
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
const currentPageIds = computed(() => items.value.map((item) => item.id))
const selectedTorrents = computed(() => selectedIds.value.map((id) => items.value.find((item) => item.id === id)).filter((item): item is TorrentItem => Boolean(item)))
const selectedPushableIds = computed(() => selectedTorrents.value.filter(canPushTorrent).map((torrent) => torrent.id))
const selectedDeletableTaskIds = computed(() => selectedTorrents.value.filter(canDeleteFromDownloader).map((torrent) => torrent.id))
const isCurrentPageAllSelected = computed(() => Boolean(items.value.length) && items.value.every((item) => selectedIds.value.includes(item.id)))
const isCurrentPagePartiallySelected = computed(() => !isCurrentPageAllSelected.value && items.value.some((item) => selectedIds.value.includes(item.id)))

async function loadTorrents() {
  loading.value = true
  error.value = ''
  try {
    const result = await getTorrents(filters)
    items.value = result.items
    total.value = result.total
    stats.value = result.stats
    selectedIds.value = selectedIds.value.filter((id) => result.items.some((item) => item.id === id))
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
  if (!canPushTorrent(torrent)) return
  pushingIds.value = [...pushingIds.value, torrent.id]
  try {
    await pushTorrent(torrent.id)
    Snackbar.success('种子已推送')
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '推送失败')
  } finally {
    pushingIds.value = pushingIds.value.filter((id) => id !== torrent.id)
  }
}

async function batchPush() {
  const ids = [...selectedPushableIds.value]
  if (!ids.length || batchPushing.value) return
  batchPushing.value = true
  pushingIds.value = [...new Set([...pushingIds.value, ...ids])]
  try {
    const result = await batchPushTorrents(ids)
    Snackbar[result.failedCount ? 'warning' : 'success'](`成功 ${result.successCount} 个，失败 ${result.failedCount} 个`)
    selectedIds.value = []
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '批量推送失败')
  } finally {
    batchPushing.value = false
    pushingIds.value = pushingIds.value.filter((id) => !ids.includes(id))
  }
}

async function batchDeleteRecords() {
  if (!selectedIds.value.length || batchDeletingRecords.value) return
  const ids = [...selectedIds.value]
  if (!window.confirm(`确认删除选中的 ${ids.length} 条种子记录？此操作不会删除下载器任务或文件。`)) return
  batchDeletingRecords.value = true
  try {
    const result = await deleteTorrentRecords(ids)
    Snackbar[result.missingIds.length ? 'warning' : 'success'](`已删除 ${result.deletedCount} 条记录`)
    selectedIds.value = selectedIds.value.filter((id) => !ids.includes(id))
    if (detail.value && ids.includes(detail.value.id)) detail.value = undefined
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '删除记录失败')
  } finally {
    batchDeletingRecords.value = false
  }
}

async function batchDeleteTasks() {
  const ids = [...selectedDeletableTaskIds.value]
  if (!ids.length || batchDeletingTasks.value) return
  if (!window.confirm(`确认删除选中的 ${ids.length} 个下载器任务并同时删除已下载文件？`)) return
  batchDeletingTasks.value = true
  deletingIds.value = [...new Set([...deletingIds.value, ...ids])]
  try {
    const result = await batchDeleteTorrentsFromDownloader(ids)
    Snackbar[result.failedCount ? 'warning' : 'success'](`成功 ${result.successCount} 个，失败 ${result.failedCount} 个`)
    selectedIds.value = []
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '批量删除任务失败')
  } finally {
    batchDeletingTasks.value = false
    deletingIds.value = deletingIds.value.filter((id) => !ids.includes(id))
  }
}

async function deleteFromDownloader(torrent: TorrentItem) {
  if (!canDeleteFromDownloader(torrent) || isTorrentBusy(torrent.id)) return
  if (!window.confirm(`确认删除下载器任务「${torrent.title}」并同时删除已下载文件？`)) return
  deletingIds.value = [...deletingIds.value, torrent.id]
  try {
    await deleteTorrentFromDownloader(torrent.id)
    Snackbar.success('下载器任务已删除')
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '删除失败')
  } finally {
    deletingIds.value = deletingIds.value.filter((id) => id !== torrent.id)
  }
}

function showDetail(torrent: TorrentItem) {
  detail.value = torrent
}

function toggleSelectCurrentPage() {
  setSelectCurrentPage(!isCurrentPageAllSelected.value)
}

function setSelectCurrentPageFromEvent(event: Event) {
  setSelectCurrentPage((event.target as HTMLInputElement).checked)
}

function setSelectCurrentPage(checked: boolean) {
  const pageIds = currentPageIds.value
  selectedIds.value = checked ? [...new Set([...selectedIds.value, ...pageIds])] : selectedIds.value.filter((id) => !pageIds.includes(id))
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

function stateText(value: TorrentItem['currentState']) {
  const map = {
    NEW: '新种子',
    FREE_NOW: '免费中',
    EXPIRING_SOON: '即将过期',
    EXPIRED: '已过期',
    PUSHED: '已推送',
    PUSH_FAILED: '推送失败',
    DOWNLOADER_DELETED: '下载器任务已删除'
  }
  return map[value]
}

function canDeleteFromDownloader(torrent: TorrentItem) {
  return torrent.pushStatus === 'PUSHED' && Boolean(torrent.torrentHash)
}

function isPushing(id: string) {
  return pushingIds.value.includes(id)
}

function isDeleting(id: string) {
  return deletingIds.value.includes(id)
}

function isTorrentBusy(id: string) {
  return isPushing(id) || isDeleting(id)
}

function canPushTorrent(torrent: TorrentItem) {
  return torrent.pushStatus !== 'PUSHED' && !isTorrentBusy(torrent.id)
}

function freeText(torrent: TorrentItem) {
  if (torrent.currentState === 'EXPIRED') return '免费已过期'
  if (!torrent.freeEndAt) return torrent.isFreeNow ? '免费中，未获取到过期时间' : '非免费'
  return `免费至 ${new Date(torrent.freeEndAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
}

onMounted(loadTorrents)
</script>
