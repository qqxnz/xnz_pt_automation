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

      <section class="sites-toolbar panel torrents-toolbar">
        <input v-model.trim="filters.keyword" placeholder="搜索标题" @keyup.enter="resetPageAndLoad" />
        <select v-model="filters.siteId" @change="resetPageAndLoad">
          <option value="">站点：全部</option>
          <option v-for="site in siteOptions" :key="site.id" :value="site.id">{{ site.displayName }}</option>
        </select>
        <select v-model="filters.taskId" @change="resetPageAndLoad">
          <option value="">任务：全部</option>
          <option v-for="task in taskOptions" :key="task.id" :value="task.id">{{ task.name }}</option>
        </select>
        <select v-model="filters.downloaderId" @change="resetPageAndLoad">
          <option value="">下载器：全部</option>
          <option v-for="downloader in downloaderOptions" :key="downloader.id" :value="downloader.id">{{ downloader.name }}</option>
        </select>
        <select v-model="filters.status" @change="resetPageAndLoad">
          <option value="ALL">状态：全部</option>
          <option value="RUNNING">运行中</option>
          <option value="NOT_RUNNING">未运行</option>
        </select>
        <select v-model="filters.freeStatus" @change="resetPageAndLoad">
          <option value="ALL">种子状态：全部</option>
          <option value="FREE_NOW">免费中</option>
          <option value="EXPIRING_SOON">即将过期</option>
          <option value="EXPIRED">已过期</option>
          <option value="NORMAL">非免费</option>
          <option value="FREE_NO_END">免费但无到期时间</option>
        </select>
        <button class="secondary-button" type="button" :disabled="loading" @click="refreshNow">
          {{ loading ? '刷新中...' : '刷新列表' }}
        </button>
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
        <div v-if="!items.length && !loading && initialLoaded" class="sites-empty">
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
            </span><span>种子</span><span>推送/免费</span><span>下载</span><span>保存位置</span><span>速度</span><span>上传/下载</span><span>操作</span>
          </div>
          <div v-for="torrent in items" :key="torrent.id" class="torrent-row">
            <input v-model="selectedIds" type="checkbox" :value="torrent.id" />
            <span>
              <strong>{{ torrent.title }}</strong>
              <small>{{ torrent.siteName }} · {{ formatBytes(torrent.size) }} · {{ discountText(torrent.discountType) }} · {{ deleteRulesText(torrent) }} · 链接{{ linkText(torrent.linkStatus) }}</small>
            </span>
            <span>
              <span class="chip" :class="pushClass(torrent.pushStatus)">{{ pushText(torrent.pushStatus) }}</span>
              <span v-if="torrent.hasIpv6Peers" class="chip ipv6-chip" :title="`${torrent.ipv6PeerCount ?? 0}/${torrent.totalPeerCount ?? 0} 个 peer 含 IPV6`">IPv6</span>
              <small>{{ torrent.errorMessage || freeText(torrent) }}</small>
            </span>
            <span>
              <strong>{{ formatProgress(torrent.downloadProgress) }}</strong>
              <small class="torrent-state-line">
                <span>{{ downloadStateText(torrent) }}</span>
                <span>分享率 {{ formatRatio(torrent.ratio) }}</span>
              </small>
            </span>
            <span>
              <strong>{{ taskSavePathText(torrent) }}</strong>
              <small>{{ downloaderSavePathText(torrent) }}</small>
            </span>
            <span>
              <strong>{{ torrent.downloaderName || '-' }}</strong>
              <small>↑ {{ formatSpeed(torrent.uploadSpeed) }} / ↓ {{ formatSpeed(torrent.downloadSpeed) }}</small>
            </span>
            <span>
              <strong>↑ {{ formatBytes(torrent.uploaded) }}</strong>
              <small>↓ {{ formatBytes(torrent.downloaded) }} · {{ formatDate(torrent.downloadStatsSyncedAt) }}</small>
            </span>
            <span class="row-actions">
              <button type="button" @click="openPushForm(torrent)">修改</button>
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
              <span v-if="torrent.hasIpv6Peers" class="chip ipv6-chip" :title="`${torrent.ipv6PeerCount ?? 0}/${torrent.totalPeerCount ?? 0} 个 peer 含 IPV6`">IPv6</span>
            </div>
            <p>{{ torrent.siteName }} · {{ formatBytes(torrent.size) }} · {{ discountText(torrent.discountType) }} · {{ deleteRulesText(torrent) }}</p>
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
              <div>
                <dt>下载进度</dt>
                <dd>{{ formatProgress(torrent.downloadProgress) }}</dd>
              </div>
              <div>
                <dt>下载状态</dt>
                <dd>{{ downloadStateText(torrent) }}</dd>
              </div>
              <div>
                <dt>任务保存位置</dt>
                <dd>{{ taskSavePathText(torrent) }}</dd>
              </div>
              <div>
                <dt>实际保存位置</dt>
                <dd>{{ downloaderSavePathText(torrent) }}</dd>
              </div>
              <div>
                <dt>分享率</dt>
                <dd>{{ formatRatio(torrent.ratio) }}</dd>
              </div>
              <div>
                <dt>上传/下载</dt>
                <dd>{{ formatBytes(torrent.uploaded) }} / {{ formatBytes(torrent.downloaded) }}</dd>
              </div>
            </dl>
            <p>{{ torrent.errorMessage || freeText(torrent) }}</p>
            <p>速度：↑ {{ formatSpeed(torrent.uploadSpeed) }} / ↓ {{ formatSpeed(torrent.downloadSpeed) }}</p>
            <p v-if="torrent.torrentHash">Hash：{{ torrent.torrentHash.slice(0, 8) }}</p>
            <p v-else-if="torrent.downloaderState">下载器状态：{{ torrent.downloaderState }}</p>
            <div class="row-actions">
              <button type="button" @click="openPushForm(torrent)">修改</button>
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
          <article><strong>下载限制</strong><span>{{ deleteRulesText(detail) }}</span></article>
          <article><strong>下载状态</strong><span>{{ formatProgress(detail.downloadProgress) }} · {{ downloadStateText(detail) }}</span></article>
          <article><strong>任务保存位置</strong><span>{{ taskSavePathText(detail) }}</span></article>
          <article><strong>实际保存位置</strong><span>{{ downloaderSavePathText(detail) }}</span></article>
          <article><strong>分享率</strong><span>{{ formatRatio(detail.ratio) }}</span></article>
          <article><strong>速度</strong><span>↑ {{ formatSpeed(detail.uploadSpeed) }} / ↓ {{ formatSpeed(detail.downloadSpeed) }}</span></article>
          <article><strong>总上传/下载</strong><span>{{ formatBytes(detail.uploaded) }} / {{ formatBytes(detail.downloaded) }}</span></article>
          <article><strong>同步时间</strong><span>{{ formatDate(detail.downloadStatsSyncedAt) }}</span></article>
          <article><strong>种链接状态</strong><span>{{ linkText(detail.linkStatus) }}</span></article>
          <article v-if="detail.errorMessage"><strong>失败原因</strong><span>{{ detail.errorMessage }}</span></article>
        </div>
      </section>
    </div>

    <div v-if="pushForm" class="modal-backdrop" @click.self="closePushForm">
      <form class="site-form push-form" @submit.prevent="submitPushForm">
        <div class="form-head">
          <div>
            <h2>修改种子设置</h2>
            <p>{{ pushForm.torrent.siteName }} · {{ pushForm.torrent.title }}</p>
          </div>
          <button type="button" :disabled="pushForm.submitting" @click="closePushForm">×</button>
        </div>
        <div class="push-form-body">
          <p v-if="pushForm.locked" class="inline-hint locked-banner">
            种子已在下载器中运行，【下载器】与【保存位置】不可修改。如需调整，请先在列表中点击【删除任务】后再操作。
          </p>
          <div class="form-grid compact-form-grid">
            <section :class="{ 'is-locked': pushForm.locked }">
              <h3>下载器</h3>
              <label>
                选择下载器
                <select v-model="pushForm.downloaderId" :required="!pushForm.locked" :disabled="pushForm.submitting || pushForm.locked || !enabledDownloaderOptions.length">
                  <option v-if="!enabledDownloaderOptions.length" value="">暂无可用下载器</option>
                  <option v-for="downloader in enabledDownloaderOptions" :key="downloader.id" :value="downloader.id">
                    {{ downloader.name }}{{ downloader.status !== 'ONLINE' ? `（${downloaderStatusText(downloader.status)}）` : '' }}
                  </option>
                </select>
              </label>
              <p v-if="!pushForm.locked && !enabledDownloaderOptions.length" class="inline-hint">没有启用的下载器，请先在【下载器】中启用至少一个。</p>
            </section>
            <section :class="{ 'is-locked': pushForm.locked }">
              <h3>保存位置</h3>
              <label>
                任务保存位置
                <input v-model.trim="pushForm.taskSavePath" :disabled="pushForm.submitting || pushForm.locked" placeholder="留空则使用下载器默认保存位置" />
              </label>
              <p v-if="!pushForm.locked" class="inline-hint">仅写入该条种子记录的【任务保存位置】字段，不会修改来源任务或下载器配置。保存后点击【推送】才会真正推送到下载器。</p>
            </section>
            <section class="rule-section">
              <h3>下载器删除条件</h3>
              <fieldset class="rule-group">
                <legend>任一命中即删除任务+文件</legend>
                <label class="inline-check"><input v-model="pushForm.onlyFreeDownload" :disabled="pushForm.submitting" type="checkbox" /> 仅免费下载（已过免费期且未下载完成）</label>
                <label class="inline-check"><input v-model="pushForm.deleteOnFreeExpire" :disabled="pushForm.submitting" type="checkbox" /> 免费到期（无视下载进度）</label>
                <div class="inline-row">
                  <span>上传速度低于</span>
                  <input v-model.number="pushForm.lowUploadKbps" :disabled="pushForm.submitting" type="number" min="0" step="1" placeholder="0 表示不启用" />
                  <span>KB/秒，持续</span>
                  <input v-model.number="pushForm.lowUploadMinutes" :disabled="pushForm.submitting" type="number" min="0" step="1" placeholder="0 表示不启用" />
                  <span>分钟</span>
                </div>
              </fieldset>
              <p v-if="pushForm.lowUploadError" class="inline-hint">{{ pushForm.lowUploadError }}</p>
            </section>
          </div>
        </div>
        <div class="form-foot">
          <p class="form-foot-tip">本次只保存设置，不会推送。如需推送到下载器，请点击【推送】按钮。</p>
          <div class="form-foot-actions">
            <button type="button" class="secondary-button" :disabled="pushForm.submitting" @click="closePushForm">取消</button>
            <button class="primary-button compact" :disabled="pushForm.submitting || (!pushForm.locked && !pushForm.downloaderId)" type="submit">{{ pushForm.submitting ? '保存中...' : '保存' }}</button>
          </div>
        </div>
      </form>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import { getDownloaders, type DownloaderListItem } from '../api/downloaders'
import { getSites, type SiteListItem } from '../api/sites'
import { getTasks, type TaskItem } from '../api/tasks'
import {
  batchDeleteTorrentsFromDownloader,
  batchPushTorrents,
  deleteTorrentRecords,
  deleteTorrentFromDownloader,
  getTorrents,
  pushTorrent,
  updateTorrentSettings,
  type TorrentFilter,
  type TorrentItem,
  type TorrentSettingsUpdate,
  type TorrentStats
} from '../api/torrents'

const emptyStats: TorrentStats = {
  total: 0,
  running: 0,
  notRunning: 0,
  auto: 0,
  manual: 0,
  pending: 0,
  failed: 0,
  expiringSoon: 0,
  totalUploaded: 0,
  totalDownloaded: 0
}

const items = ref<TorrentItem[]>([])
const siteOptions = ref<SiteListItem[]>([])
const taskOptions = ref<TaskItem[]>([])
const downloaderOptions = ref<DownloaderListItem[]>([])
const selectedIds = ref<string[]>([])
const detail = ref<TorrentItem>()
const total = ref(0)
const loading = ref(false)
const initialLoaded = ref(false)
const batchPushing = ref(false)
const batchDeletingRecords = ref(false)
const batchDeletingTasks = ref(false)
const pushingIds = ref<string[]>([])
const deletingIds = ref<string[]>([])
const error = ref('')
const stats = ref<TorrentStats>({ ...emptyStats })
type PushFormState = {
  torrent: TorrentItem
  downloaderId: string
  taskSavePath: string
  onlyFreeDownload: boolean
  deleteOnFreeExpire: boolean
  lowUploadKbps: number
  lowUploadMinutes: number
  lowUploadError: string
  submitting: boolean
  locked: boolean
}
const pushForm = ref<PushFormState>()
let refreshTimer: number | undefined
const filters = reactive<Required<Pick<TorrentFilter, 'keyword' | 'siteId' | 'downloaderId' | 'taskId' | 'status' | 'freeStatus' | 'page' | 'pageSize'>>>({
  keyword: '',
  siteId: '',
  downloaderId: '',
  taskId: '',
  status: 'ALL',
  freeStatus: 'ALL',
  page: 1,
  pageSize: 20
})

const totalPages = computed(() => Math.max(Math.ceil(total.value / filters.pageSize), 1))
const statCards = computed(() => [
  { label: '全部种子', value: stats.value.total, className: '' },
  { label: '运行中', value: stats.value.running, className: 'success' },
  { label: '未运行', value: stats.value.notRunning, className: 'danger' },
  { label: '总上传', value: formatBytes(stats.value.totalUploaded), className: 'success' },
  { label: '总下载', value: formatBytes(stats.value.totalDownloaded), className: '' }
])
const currentPageIds = computed(() => items.value.map((item) => item.id))
const selectedTorrents = computed(() => selectedIds.value.map((id) => items.value.find((item) => item.id === id)).filter((item): item is TorrentItem => Boolean(item)))
const selectedPushableIds = computed(() => selectedTorrents.value.filter(canPushTorrent).map((torrent) => torrent.id))
const selectedDeletableTaskIds = computed(() => selectedTorrents.value.filter(canDeleteFromDownloader).map((torrent) => torrent.id))
const isCurrentPageAllSelected = computed(() => Boolean(items.value.length) && items.value.every((item) => selectedIds.value.includes(item.id)))
const isCurrentPagePartiallySelected = computed(() => !isCurrentPageAllSelected.value && items.value.some((item) => selectedIds.value.includes(item.id)))
const enabledDownloaderOptions = computed(() => downloaderOptions.value.filter((downloader) => downloader.enabled))

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
    initialLoaded.value = true
  }
}

async function loadFilterOptions() {
  const [sites, tasks, downloaders] = await Promise.all([
    getSites({ page: 1, pageSize: 100 }),
    getTasks({}),
    getDownloaders({})
  ])
  siteOptions.value = sites.items
  taskOptions.value = tasks.items
  downloaderOptions.value = downloaders.items
}

function resetPageAndLoad() {
  filters.page = 1
  loadTorrents()
}

function refreshNow() {
  loadTorrents()
}

function changePage(page: number) {
  filters.page = Math.min(Math.max(page, 1), totalPages.value)
  loadTorrents()
}

async function reloadAfterMutation() {
  await loadTorrents()
  if (filters.page > totalPages.value) {
    filters.page = Math.max(1, totalPages.value)
    await loadTorrents()
  }
}

function openPushForm(torrent: TorrentItem) {
  const current = downloaderOptions.value.find((item) => item.id === torrent.downloaderId)
  const fallback = enabledDownloaderOptions.value[0]?.id ?? ''
  const initialDownloaderId = current?.enabled
    ? current.id
    : torrent.downloaderId && enabledDownloaderOptions.value.some((item) => item.id === torrent.downloaderId)
      ? torrent.downloaderId
      : fallback
  pushForm.value = {
    torrent,
    downloaderId: initialDownloaderId,
    taskSavePath: torrent.taskSavePath ?? '',
    onlyFreeDownload: Boolean(torrent.onlyFreeDownload),
    deleteOnFreeExpire: Boolean(torrent.deleteOnFreeExpire),
    lowUploadKbps: torrent.lowUploadKbps ?? 0,
    lowUploadMinutes: torrent.lowUploadMinutes ?? 0,
    lowUploadError: '',
    submitting: false,
    locked: isTorrentInDownloader(torrent)
  }
}

function closePushForm() {
  if (pushForm.value?.submitting) return
  pushForm.value = undefined
}

async function submitPushForm() {
  const form = pushForm.value
  if (!form || form.submitting) return
  if (!form.locked && !form.downloaderId) {
    Snackbar.warning('请选择下载器')
    return
  }
  const kbps = Number(form.lowUploadKbps) || 0
  const mins = Number(form.lowUploadMinutes) || 0
  if ((kbps > 0) !== (mins > 0)) {
    form.lowUploadError = '低速删除的速度阈值和持续时间需同时填写'
    Snackbar.warning(form.lowUploadError)
    return
  }
  if (kbps > 0 && (!Number.isInteger(kbps) || kbps < 1)) {
    form.lowUploadError = '低速删除的速度阈值必须是大于等于 1 的整数'
    Snackbar.warning(form.lowUploadError)
    return
  }
  if (mins > 0 && (!Number.isInteger(mins) || mins < 1)) {
    form.lowUploadError = '低速删除的持续时间必须是大于等于 1 的整数'
    Snackbar.warning(form.lowUploadError)
    return
  }
  form.lowUploadError = ''
  form.submitting = true
  try {
    const payload: TorrentSettingsUpdate = {
      onlyFreeDownload: form.onlyFreeDownload,
      deleteOnFreeExpire: form.deleteOnFreeExpire,
      lowUploadKbps: kbps > 0 ? kbps : null,
      lowUploadMinutes: mins > 0 ? mins : null
    }
    if (!form.locked) {
      payload.downloaderId = form.downloaderId
      payload.taskSavePath = form.taskSavePath
    }
    await updateTorrentSettings(form.torrent.id, payload)
    Snackbar.success('已保存修改')
    pushForm.value = undefined
    await loadTorrents()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    if (pushForm.value && pushForm.value.torrent.id === form.torrent.id) {
      pushForm.value.submitting = false
    }
  }
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
    await reloadAfterMutation()
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
    await reloadAfterMutation()
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
    await reloadAfterMutation()
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

function formatSpeed(value?: number) {
  if (value === undefined) return '-'
  return `${formatBytes(value)}/s`
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatProgress(value?: number) {
  if (value === undefined) return '-'
  return `${Math.round(value * 100)}%`
}

function formatRatio(value?: number) {
  return value === undefined ? '-' : value.toFixed(2)
}

function downloadStateText(torrent: TorrentItem) {
  return torrent.downloadState || torrent.downloaderState || '-'
}

function taskSavePathText(torrent: TorrentItem) {
  return torrent.taskSavePath || '使用下载器配置'
}

function downloaderSavePathText(torrent: TorrentItem) {
  return torrent.downloaderSavePath || '未同步'
}

function discountText(value: TorrentItem['discountType']) {
  return value === 'TWO_X_FREE' ? '2X FREE' : value === 'HALF_FREE' ? '50% FREE' : value === 'NORMAL' ? '不免费' : value
}

function runModeText(value: TorrentItem['sourceRunMode']) {
  return value === 'AUTO' ? '自动执行' : '手动运行'
}

function downloaderStatusText(status: DownloaderListItem['status']) {
  return status === 'ONLINE' ? '在线' : status === 'OFFLINE' ? '离线' : status === 'AUTH_FAILED' ? '认证失败' : '未知'
}

function deleteRulesText(torrent: Pick<TorrentItem, 'onlyFreeDownload' | 'deleteOnFreeExpire' | 'lowUploadKbps' | 'lowUploadMinutes'>) {
  const parts: string[] = []
  if (torrent.onlyFreeDownload) parts.push('仅免费')
  if (torrent.deleteOnFreeExpire) parts.push('免费到期')
  if (torrent.lowUploadKbps && torrent.lowUploadMinutes) parts.push(`低速${torrent.lowUploadKbps}KB·${torrent.lowUploadMinutes}分`)
  if (!parts.length) return '允许非免费继续下载'
  return parts.join(' / ')
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

function isTorrentInDownloader(torrent: TorrentItem) {
  return torrent.pushStatus === 'PUSHED' && Boolean(torrent.torrentHash)
}

function freeText(torrent: TorrentItem) {
  if (torrent.currentState === 'EXPIRED') return '免费已过期'
  if (!torrent.freeEndAt) return torrent.isFreeNow ? '免费中，未获取到过期时间' : '非免费'
  return `免费至 ${new Date(torrent.freeEndAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
}

function stopRealtimeRefresh() {
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
  refreshTimer = undefined
}

function startRealtimeRefresh() {
  stopRealtimeRefresh()
  if (document.hidden) return
  loadTorrents()
  refreshTimer = window.setInterval(() => loadTorrents(), 3000)
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopRealtimeRefresh()
  } else {
    startRealtimeRefresh()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  loadFilterOptions().catch(() => undefined)
  startRealtimeRefresh()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  stopRealtimeRefresh()
})
</script>
