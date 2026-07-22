<template>
  <AppLayout>
    <section class="notifications-page">
      <CCPageHeader eyebrow="通知管理" title="通知渠道" description="配置事件通知渠道，并查看最近一次发送状态。" :meta="lastUpdatedAt ? `最近更新：${lastUpdatedAt}` : '等待同步'">
        <template #actions>
          <button class="primary-button compact" type="button" @click="openCreate">新增通知配置</button>
        </template>
      </CCPageHeader>

      <section class="notification-overview cc-card">
        <div class="overview-heading"><span class="page-eyebrow">配置概览</span><small>发送结果进入通知日志</small></div>
        <article><strong>{{ stats.total }}</strong><span>已配置</span></article>
        <article><strong class="success">{{ stats.enabled }}</strong><span>已启用</span></article>
        <article><strong class="danger">{{ stats.failed }}</strong><span>最近失败</span></article>
        <router-link to="/logs?type=notification">查看通知日志 →</router-link>
      </section>

      <section class="cc-card cc-list-surface notification-list-surface">
        <div v-if="error" class="error-banner">{{ error }}<button type="button" @click="loadNotifications">重试</button></div>
        <div class="panel-title-row"><h2>通知配置</h2><span>Token 仅显示配置状态，不回显明文</span></div>
        <CCStateView v-if="loading && !items.length" title="正在加载通知配置" description="正在读取通知渠道与最近发送状态。" tone="loading" />
        <CCStateView v-else-if="!items.length" title="还没有通知配置" description="添加爱语飞飞配置后，即可接收业务事件通知。">
          <button class="primary-button compact" type="button" @click="openCreate">新增通知配置</button>
        </CCStateView>
        <div v-else class="notification-config-list">
          <article v-for="item in items" :key="item.id" class="notification-config-card">
            <div class="notification-icon">◆</div>
            <div class="notification-config-body">
              <div class="notification-title-row">
                <h3>{{ item.name }}</h3>
                <span class="chip" :class="item.enabled ? 'success-chip' : 'muted-chip'">{{ item.enabled ? '已启用' : '已停用' }}</span>
              </div>
              <p>爱语飞飞 · {{ item.hasToken ? 'Token 已配置' : 'Token 未配置' }} · 更新于 {{ formatTime(item.updatedAt) }}</p>
              <div class="notification-events"><span v-for="event in item.events" :key="event">{{ eventText(event) }}</span></div>
              <p v-if="item.lastResult" class="notification-result" :class="item.lastResult.status === 'SUCCESS' ? 'success' : 'danger'">
                {{ item.lastResult.status === 'SUCCESS' ? '✓' : '!' }} {{ item.lastResult.title }} · {{ formatTime(item.lastResult.createdAt) }}
                <small v-if="item.lastResult.errorMessage">{{ item.lastResult.errorMessage }}</small>
              </p>
              <p v-else class="notification-result muted">暂无发送记录</p>
            </div>
            <div class="notification-card-actions">
              <button class="secondary-button blue" type="button" :disabled="testingId === item.id" @click="runTest(item)">{{ testingId === item.id ? '测试中...' : '测试通知' }}</button>
              <button class="secondary-button" type="button" @click="openEdit(item)">编辑</button>
              <button class="secondary-button danger-button" type="button" @click="removeItem(item)">删除</button>
            </div>
          </article>
        </div>
      </section>
    </section>

    <div v-if="formVisible" class="cc-modal-backdrop modal-backdrop" @click.self="closeForm">
      <form class="cc-form-dialog site-form notification-form" @submit.prevent="saveItem">
        <div class="cc-form-head form-head">
          <div><h2>{{ editingId ? '编辑通知配置' : '新增通知配置' }}</h2><p>配置爱语飞飞 Token，并选择需要接收的业务事件。</p></div>
          <button type="button" @click="closeForm">×</button>
        </div>
        <div class="notification-form-content">
          <section>
            <h3>基础信息</h3>
            <div class="notification-form-grid">
              <label>配置名称<input v-model.trim="form.name" required maxlength="50" placeholder="微信通知" /></label>
              <label>通知渠道<select v-model="form.provider" disabled><option value="IYUU">爱语飞飞</option></select></label>
            </div>
            <label class="inline-check"><input v-model="form.enabled" type="checkbox" />启用此通知配置</label>
          </section>
          <section>
            <h3>连接凭证</h3>
            <label>IYUU Token
              <div class="password-input"><input v-model="form.token" :type="tokenVisible ? 'text' : 'password'" :placeholder="editingId ? '留空表示保留已保存 Token' : '请输入 IYUU Token'" /><button type="button" @click="tokenVisible = !tokenVisible">{{ tokenVisible ? '隐藏' : '显示' }}</button></div>
            </label>
            <p class="form-help">Token 仅用于服务端发送通知，不会在配置列表或日志中回显。</p>
          </section>
          <section>
            <h3>通知事件</h3><p class="form-help">至少选择一个事件；成功与失败结果都会通知，批量操作按业务批次汇总。</p>
            <div class="notification-event-grid">
              <label v-for="option in eventOptions" :key="option.value" :class="{ selected: form.events.includes(option.value) }">
                <input v-model="form.events" type="checkbox" :value="option.value" /><span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
              </label>
            </div>
          </section>
        </div>
        <div class="cc-form-foot form-foot"><span>{{ validationHint }}</span><button type="button" class="secondary-button" @click="closeForm">取消</button><button type="button" class="secondary-button blue" :disabled="saving || testingDraft" @click="runDraftTest">{{ testingDraft ? '测试中...' : '发送测试通知' }}</button><button class="primary-button compact" :disabled="saving || testingDraft" type="submit">{{ saving ? '保存中...' : '保存配置' }}</button></div>
      </form>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from '@varlet/ui'
import { onMounted, reactive, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import CCPageHeader from '../components/CCPageHeader.vue'
import CCStateView from '../components/CCStateView.vue'
import { createNotification, deleteNotification, getNotifications, testNotification, testNotificationDraft, updateNotification, type NotificationEvent, type NotificationListItem, type NotificationStats } from '../api/notifications'

const eventOptions: Array<{ value: NotificationEvent; label: string; description: string }> = [
  { value: 'SITE_SIGNIN', label: '站点签到', description: '手动、批量及自动签到结果' },
  { value: 'TASK_TRIGGERED', label: '任务触发', description: '自动或手动任务的最终结果' },
  { value: 'TORRENT_ADDED', label: '种子添加', description: '推送下载器的成功或失败结果' },
  { value: 'TORRENT_DELETED', label: '种子删除', description: '手动或自动删除下载器任务' }
]
const items = ref<NotificationListItem[]>([])
const stats = ref<NotificationStats>({ total: 0, enabled: 0, failed: 0 })
const loading = ref(false)
const saving = ref(false)
const testingId = ref('')
const testingDraft = ref(false)
const error = ref('')
const lastUpdatedAt = ref('')
const formVisible = ref(false)
const editingId = ref('')
const tokenVisible = ref(false)
const form = reactive<{ name: string; provider: 'IYUU'; enabled: boolean; token: string; events: NotificationEvent[] }>({ name: '', provider: 'IYUU', enabled: true, token: '', events: ['SITE_SIGNIN', 'TASK_TRIGGERED'] })
const validationHint = ref('Token 不会回显；编辑时留空表示保留原值。')

function eventText(event: NotificationEvent) { return eventOptions.find((item) => item.value === event)?.label ?? event }
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }
function resetForm() { editingId.value = ''; tokenVisible.value = false; validationHint.value = 'Token 不会回显；编辑时留空表示保留原值。'; Object.assign(form, { name: '', provider: 'IYUU', enabled: true, token: '', events: ['SITE_SIGNIN', 'TASK_TRIGGERED'] as NotificationEvent[] }) }
function openCreate() { resetForm(); formVisible.value = true }
function openEdit(item: NotificationListItem) { resetForm(); editingId.value = item.id; Object.assign(form, { name: item.name, provider: item.provider, enabled: item.enabled, token: '', events: [...item.events] }); formVisible.value = true }
function closeForm() { formVisible.value = false }

async function loadNotifications() { loading.value = true; error.value = ''; try { const result = await getNotifications(); items.value = result.items; stats.value = result.stats; lastUpdatedAt.value = new Date().toLocaleString('zh-CN') } catch (err) { error.value = err instanceof Error ? err.message : '通知配置加载失败' } finally { loading.value = false } }
async function saveItem() {
  if (!form.name.trim()) return void Snackbar.warning('配置名称不能为空')
  if (!form.events.length) { validationHint.value = '请选择至少一个通知事件'; return void Snackbar.warning(validationHint.value) }
  if (!editingId.value && !form.token.trim()) return void Snackbar.warning('IYUU Token 不能为空')
  saving.value = true
  try {
    const payload = { name: form.name.trim(), provider: form.provider, enabled: form.enabled, token: form.token.trim() || undefined, tokenAction: form.token.trim() ? 'UPDATE' as const : 'KEEP' as const, events: form.events }
    if (editingId.value) await updateNotification(editingId.value, payload); else await createNotification(payload)
    formVisible.value = false; Snackbar.success('通知配置已保存'); await loadNotifications()
  } catch (err) { Snackbar.error(err instanceof Error ? err.message : '保存失败') } finally { saving.value = false }
}
async function runTest(item: NotificationListItem) { testingId.value = item.id; try { const result = await testNotification(item.id); Snackbar.success(result.message) } catch (err) { Snackbar.error(err instanceof Error ? err.message : '测试通知发送失败') } finally { testingId.value = ''; await loadNotifications() } }
async function runDraftTest() {
  if (!form.name.trim()) return void Snackbar.warning('配置名称不能为空')
  if (!form.events.length) return void Snackbar.warning('请选择至少一个通知事件')
  if (!editingId.value && !form.token.trim()) return void Snackbar.warning('IYUU Token 不能为空')
  testingDraft.value = true
  try {
    const result = await testNotificationDraft({ id: editingId.value || undefined, name: form.name.trim(), provider: form.provider, enabled: form.enabled, token: form.token.trim() || undefined, tokenAction: form.token.trim() ? 'UPDATE' : 'KEEP', events: form.events })
    Snackbar.success(result.message)
  } catch (err) { Snackbar.error(err instanceof Error ? err.message : '测试通知发送失败') } finally { testingDraft.value = false; await loadNotifications() }
}
async function removeItem(item: NotificationListItem) { if (!window.confirm(`确认删除通知配置「${item.name}」？历史通知日志会保留。`)) return; try { await deleteNotification(item.id); Snackbar.success('通知配置已删除'); await loadNotifications() } catch (err) { Snackbar.error(err instanceof Error ? err.message : '删除失败') } }

onMounted(loadNotifications)
</script>
