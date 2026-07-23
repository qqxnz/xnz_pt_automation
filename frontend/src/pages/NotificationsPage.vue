<template>
  <AppLayout>
    <section class="notifications-page">
      <CCPageHeader
        eyebrow="通知管理"
        title="通知渠道"
        description="配置事件通知渠道，并查看最近一次发送状态。"
        :meta="lastUpdatedAt ? `最近更新：${lastUpdatedAt}` : '等待同步'"
      >
        <template #actions>
          <button class="primary-button compact" type="button" @click="openCreate">新增通知配置</button>
        </template>
      </CCPageHeader>

      <section class="notification-overview cc-card" aria-label="通知配置概览">
        <div class="notification-overview-primary">
          <div class="overview-heading">
            <span class="page-eyebrow">配置概览</span>
          </div>
          <div class="notification-overview-metrics">
            <article>
              <strong>{{ stats.total }}</strong>
              <span class="desktop-label">已配置</span><span class="mobile-label">配置</span>
            </article>
            <article>
              <strong class="success">{{ stats.enabled }}</strong>
              <span class="desktop-label">已启用</span><span class="mobile-label">启用</span>
            </article>
            <article>
              <strong class="danger">{{ stats.failed }}</strong>
              <span class="desktop-label">最近失败</span><span class="mobile-label">失败</span>
            </article>
          </div>
        </div>
        <div class="notification-event-summary">
          <span>已订阅事件</span>
          <div>
            <small v-for="option in eventOptions" :key="option.value">
              {{ option.shortLabel }} <strong>{{ eventCounts[option.value] }}</strong>
            </small>
          </div>
        </div>
        <router-link to="/logs?type=notification">发送结果进入通知日志 →</router-link>
      </section>

      <section class="cc-card cc-list-surface notification-list-surface">
        <div v-if="error" class="error-banner">
          {{ error }}<button type="button" @click="loadNotifications">重试</button>
        </div>
        <div class="panel-title-row">
          <h2>通知配置</h2>
          <span>Token 仅显示配置状态，不回显明文</span>
        </div>
        <CCStateView
          v-if="loading && !items.length"
          title="正在加载通知配置"
          description="正在读取通知渠道与最近发送状态。"
          tone="loading"
        />
        <div v-else-if="!items.length" class="notification-empty-state">
          <div class="notification-empty-icon">◆</div>
          <h3>还没有通知配置</h3>
          <p>添加爱语飞飞配置后，即可接收站点签到、任务和种子事件通知。</p>
          <a href="https://iyuu.cn" target="_blank" rel="noreferrer">前往 iyuu.cn 获取 Token →</a>
          <small>通知发送失败不会影响原业务执行，详细结果可在「日志 → 通知日志」中查看。</small>
          <button class="primary-button compact" type="button" @click="openCreate">新增通知配置</button>
        </div>
        <div v-else class="notification-config-list">
          <article
            v-for="item in items"
            :key="item.id"
            class="notification-config-card"
            :class="{ 'is-disabled': !item.enabled, 'has-failure': item.lastResult?.status === 'FAILED' }"
          >
            <div class="notification-icon">
              {{ item.lastResult?.status === 'FAILED' ? '!' : '◆' }}
            </div>
            <div class="notification-config-body">
              <div class="notification-title-row">
                <h3>{{ item.name }}</h3>
                <span class="chip" :class="item.enabled ? 'success-chip' : 'muted-chip'">
                  {{ item.enabled ? '已启用' : '已停用' }}
                </span>
              </div>
              <p>
                爱语飞飞 · {{ item.hasToken ? 'Token 已配置' : 'Token 未配置' }} ·
                {{ item.enabled ? (item.lastResult ? `最近发送 ${formatTime(item.lastResult.createdAt)}` : `更新于 ${formatTime(item.updatedAt)}`) : '停用期间不发送通知' }}
              </p>
              <div class="notification-events">
                <span v-for="event in item.events" :key="event">{{ eventText(event) }}</span>
              </div>
              <p
                v-if="item.lastResult"
                class="notification-result"
                :class="item.lastResult.status === 'SUCCESS' ? 'success' : 'danger'"
              >
                {{ item.lastResult.status === 'SUCCESS' ? '✓ 最近发送成功' : '! 最近发送失败' }} ·
                {{ item.lastResult.errorMessage || item.lastResult.title }}
              </p>
              <p v-else class="notification-result muted">暂无发送记录</p>
            </div>
            <div class="notification-card-actions">
              <button
                v-if="item.enabled"
                class="secondary-button blue row-primary-action"
                type="button"
                :disabled="testingId === item.id || togglingId === item.id"
                @click="runTest(item)"
              >
                {{ testingId === item.id ? '测试中...' : item.lastResult?.status === 'FAILED' ? '重新测试' : '测试通知' }}
              </button>
              <AppActionMenu
                :items="cardMenuItems"
                :label="`${item.name}配置操作`"
                @select="onCardAction($event, item)"
              />
              <button
                class="notification-switch"
                :class="{ on: item.enabled }"
                type="button"
                role="switch"
                :aria-checked="item.enabled"
                :aria-label="`${item.enabled ? '停用' : '启用'}${item.name}`"
                :disabled="togglingId === item.id || testingId === item.id"
                @click="toggleItem(item)"
              >
                <span />
              </button>
            </div>
          </article>
        </div>
      </section>
    </section>

    <div v-if="formVisible" class="cc-modal-backdrop modal-backdrop" @click.self="closeForm">
      <form class="cc-form-dialog site-form notification-form" @submit.prevent="saveItem">
        <div class="cc-form-head form-head">
          <div>
            <h2>{{ editingId ? '编辑通知配置' : '新增通知配置' }}</h2>
            <p>配置爱语飞飞 Token，并选择需要接收的业务事件。</p>
          </div>
          <button type="button" aria-label="关闭通知配置表单" @click="closeForm">×</button>
        </div>
        <div class="notification-form-content">
          <section>
            <h3>基础信息</h3>
            <div class="notification-form-grid">
              <label>配置名称 <b class="required-mark">*</b><input v-model.trim="form.name" required maxlength="50" placeholder="微信通知" /></label>
              <label>通知渠道<select v-model="form.provider" disabled><option value="IYUU">爱语飞飞</option></select></label>
            </div>
            <label class="inline-check"><input v-model="form.enabled" type="checkbox" />启用此通知配置</label>
          </section>
          <section>
            <h3>连接凭证</h3>
            <label>IYUU Token <b v-if="!editingId" class="required-mark">*</b>
              <div class="password-input">
                <input
                  v-model="form.token"
                  :type="tokenVisible ? 'text' : 'password'"
                  :placeholder="editingId ? '留空表示保留已保存 Token' : '请输入 IYUU Token'"
                />
                <button type="button" @click="tokenVisible = !tokenVisible">{{ tokenVisible ? '隐藏' : '显示' }}</button>
              </div>
            </label>
            <p class="form-help">前往 <a href="https://iyuu.cn" target="_blank" rel="noreferrer">iyuu.cn</a> 获取 Token。编辑已有配置时留空表示保留已保存 Token。</p>
            <div class="notification-security-note">
              <strong>安全说明</strong>
              <span>Token 仅用于服务端发送通知，不在配置列表、操作日志或通知日志中回显。</span>
            </div>
          </section>
          <section>
            <h3>通知事件 <b class="required-mark">*</b></h3>
            <p class="form-help">至少选择一个事件；成功与失败结果都会通知，批量操作按业务批次汇总。</p>
            <div class="notification-event-grid">
              <label v-for="option in eventOptions" :key="option.value" :class="{ selected: form.events.includes(option.value) }">
                <input v-model="form.events" type="checkbox" :value="option.value" />
                <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </label>
            </div>
          </section>
          <section class="notification-test-section">
            <h3>测试与校验状态</h3>
            <div v-if="formFeedback" class="notification-form-feedback" :class="formFeedback.tone" role="status">
              <strong>{{ formFeedback.title }}</strong>
              <span v-if="formFeedback.message">{{ formFeedback.message }}</span>
            </div>
            <p v-else class="notification-form-placeholder">填写配置后可发送测试通知，测试结果也会记录到通知日志。</p>
            <button
              class="secondary-button blue notification-mobile-test"
              type="button"
              :disabled="saving || testingDraft"
              @click="runDraftTest"
            >
              {{ testingDraft ? '测试中...' : '发送测试通知' }}
            </button>
          </section>
        </div>
        <div class="cc-form-foot form-foot notification-form-foot">
          <span>{{ validationHint }}</span>
          <div>
            <button type="button" class="secondary-button" @click="closeForm">取消</button>
            <button type="button" class="secondary-button blue notification-desktop-test" :disabled="saving || testingDraft" @click="runDraftTest">
              {{ testingDraft ? '测试中...' : '发送测试通知' }}
            </button>
            <button class="primary-button compact" :disabled="saving || testingDraft" type="submit">
              {{ saving ? '保存中...' : '保存配置' }}
            </button>
          </div>
        </div>
      </form>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppActionMenu, { type AppActionMenuItem } from '../components/AppActionMenu.vue'
import AppLayout from '../components/AppLayout.vue'
import CCPageHeader from '../components/CCPageHeader.vue'
import CCStateView from '../components/CCStateView.vue'
import {
  createNotification,
  deleteNotification,
  getNotifications,
  testNotification,
  testNotificationDraft,
  updateNotification,
  type NotificationEvent,
  type NotificationListItem,
  type NotificationStats
} from '../api/notifications'

type FormFeedback = { tone: 'success' | 'danger' | 'warning'; title: string; message?: string }

const router = useRouter()
const eventOptions: Array<{ value: NotificationEvent; label: string; shortLabel: string; description: string }> = [
  { value: 'SITE_SIGNIN', label: '站点签到', shortLabel: '签到', description: '手动、批量及自动签到结果' },
  { value: 'TASK_TRIGGERED', label: '任务触发', shortLabel: '任务', description: '自动或手动任务的最终结果' },
  { value: 'TORRENT_ADDED', label: '种子添加', shortLabel: '添加', description: '推送下载器的成功或失败结果' },
  { value: 'TORRENT_DELETED', label: '种子删除', shortLabel: '删除', description: '手动或自动删除下载器任务' },
  { value: 'DAILY_TRAFFIC', label: '每日流量通知', shortLabel: '流量', description: '每日 00:05 推送昨日各站点上传/下载量' }
]
const cardMenuItems: AppActionMenuItem[] = [
  { key: 'edit', label: '编辑配置' },
  { key: 'logs', label: '查看通知日志' },
  { key: 'delete', label: '删除配置', tone: 'danger' }
]
const items = ref<NotificationListItem[]>([])
const stats = ref<NotificationStats>({ total: 0, enabled: 0, failed: 0 })
const loading = ref(false)
const saving = ref(false)
const testingId = ref('')
const togglingId = ref('')
const testingDraft = ref(false)
const error = ref('')
const lastUpdatedAt = ref('')
const formVisible = ref(false)
const editingId = ref('')
const tokenVisible = ref(false)
const formFeedback = ref<FormFeedback>()
const form = reactive<{ name: string; provider: 'IYUU'; enabled: boolean; token: string; events: NotificationEvent[] }>({
  name: '', provider: 'IYUU', enabled: true, token: '', events: ['SITE_SIGNIN', 'TASK_TRIGGERED', 'TORRENT_ADDED', 'TORRENT_DELETED', 'DAILY_TRAFFIC']
})
const validationHint = ref('Token 不会回显；编辑时留空表示保留原值。')
const eventCounts = computed<Record<NotificationEvent, number>>(() => ({
  SITE_SIGNIN: items.value.filter((item) => item.events.includes('SITE_SIGNIN')).length,
  TASK_TRIGGERED: items.value.filter((item) => item.events.includes('TASK_TRIGGERED')).length,
  TORRENT_ADDED: items.value.filter((item) => item.events.includes('TORRENT_ADDED')).length,
  TORRENT_DELETED: items.value.filter((item) => item.events.includes('TORRENT_DELETED')).length,
  DAILY_TRAFFIC: items.value.filter((item) => item.events.includes('DAILY_TRAFFIC')).length
}))

function eventText(event: NotificationEvent) { return eventOptions.find((item) => item.value === event)?.label ?? event }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function resetForm() {
  editingId.value = ''
  tokenVisible.value = false
  formFeedback.value = undefined
  validationHint.value = 'Token 不会回显；编辑时留空表示保留原值。'
  Object.assign(form, { name: '', provider: 'IYUU', enabled: true, token: '', events: ['SITE_SIGNIN', 'TASK_TRIGGERED', 'TORRENT_ADDED', 'TORRENT_DELETED', 'DAILY_TRAFFIC'] as NotificationEvent[] })
}
function openCreate() { resetForm(); formVisible.value = true }
function openEdit(item: NotificationListItem) {
  resetForm()
  editingId.value = item.id
  Object.assign(form, { name: item.name, provider: item.provider, enabled: item.enabled, token: '', events: [...item.events] })
  formVisible.value = true
}
function closeForm() { formVisible.value = false }

function validateForm() {
  let message = ''
  if (!form.name.trim()) message = '配置名称不能为空'
  else if (!form.events.length) message = '请选择至少一个通知事件'
  else if (!editingId.value && !form.token.trim()) message = 'IYUU Token 不能为空'
  if (!message) return true
  validationHint.value = message
  formFeedback.value = { tone: 'warning', title: '请检查配置内容', message }
  Snackbar.warning(message)
  return false
}

async function loadNotifications() {
  loading.value = true
  error.value = ''
  try {
    const result = await getNotifications()
    items.value = result.items
    stats.value = result.stats
    lastUpdatedAt.value = new Date().toLocaleString('zh-CN')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '通知配置加载失败'
  } finally {
    loading.value = false
  }
}

async function saveItem() {
  if (!validateForm()) return
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(), provider: form.provider, enabled: form.enabled,
      token: form.token.trim() || undefined,
      tokenAction: form.token.trim() ? 'UPDATE' as const : 'KEEP' as const,
      events: form.events
    }
    if (editingId.value) await updateNotification(editingId.value, payload)
    else await createNotification(payload)
    formVisible.value = false
    Snackbar.success('通知配置已保存')
    await loadNotifications()
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存失败'
    formFeedback.value = { tone: 'danger', title: '配置保存失败', message }
    Snackbar.error(message)
  } finally {
    saving.value = false
  }
}

async function runTest(item: NotificationListItem) {
  testingId.value = item.id
  try {
    const result = await testNotification(item.id)
    Snackbar.success(result.message)
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '测试通知发送失败')
  } finally {
    testingId.value = ''
    await loadNotifications()
  }
}

async function runDraftTest() {
  if (!validateForm()) return
  testingDraft.value = true
  formFeedback.value = undefined
  try {
    const result = await testNotificationDraft({
      id: editingId.value || undefined,
      name: form.name.trim(), provider: form.provider, enabled: form.enabled,
      token: form.token.trim() || undefined,
      tokenAction: form.token.trim() ? 'UPDATE' : 'KEEP', events: form.events
    })
    formFeedback.value = { tone: 'success', title: '✓ 测试通知发送成功', message: result.message }
    validationHint.value = '测试成功，可以保存当前配置。'
  } catch (err) {
    const message = err instanceof Error ? err.message : '测试通知发送失败'
    formFeedback.value = { tone: 'danger', title: '! 测试通知发送失败', message }
    validationHint.value = '请检查 Token 或爱语飞飞服务状态。'
  } finally {
    testingDraft.value = false
    await loadNotifications()
  }
}

async function toggleItem(item: NotificationListItem) {
  togglingId.value = item.id
  try {
    await updateNotification(item.id, {
      name: item.name, provider: item.provider, enabled: !item.enabled,
      tokenAction: 'KEEP', events: item.events
    })
    Snackbar.success(`已${item.enabled ? '停用' : '启用'}「${item.name}」`)
    await loadNotifications()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '通知配置状态更新失败')
  } finally {
    togglingId.value = ''
  }
}

function onCardAction(action: string, item: NotificationListItem) {
  if (action === 'edit') openEdit(item)
  else if (action === 'logs') router.push({ path: '/logs', query: { type: 'notification' } })
  else if (action === 'delete') removeItem(item)
}

async function removeItem(item: NotificationListItem) {
  if (!window.confirm(`确认删除通知配置「${item.name}」？历史通知日志会保留。`)) return
  try {
    await deleteNotification(item.id)
    Snackbar.success('通知配置已删除')
    await loadNotifications()
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : '删除失败')
  }
}

onMounted(loadNotifications)
</script>
