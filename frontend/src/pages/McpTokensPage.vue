<template>
  <AppLayout>
    <section class="mcp-tokens-page">
      <CCPageHeader
        eyebrow="系统设置"
        title="MCP 接入"
        description="为 AI Agent 生成访问 PT 自动化系统的 API Token。"
        meta="MCP 控制台"
      >
        <template #actions>
          <button
            class="primary-button compact"
            type="button"
            :disabled="creating"
            @click="openCreateDialog"
          >
            {{ creating ? '生成中…' : '生成新 Token' }}
          </button>
        </template>
      </CCPageHeader>

      <div v-if="error" class="error-banner">
        {{ error }}
        <button type="button" @click="load">重试</button>
      </div>

      <section class="cc-card mcp-info-card">
        <h2>接入说明</h2>
        <p>
          MCP（Model Context Protocol）是 Anthropic 提出的 Agent ↔ 工具协议。本系统暴露两类接入：
        </p>
        <ul class="mcp-info-list">
          <li><strong>HTTP</strong>：端点 <code>POST http://&lt;nas&gt;:3180/mcp</code>，Header 携带 <code>X-MCP-Token</code>。默认仅本机可访问，远程需在【系统设置】中关闭 <code>mcp_require_loopback</code>。</li>
          <li><strong>stdio</strong>：通过容器内 <code>mcp-server stdio</code> 启动；需要环境变量 <code>PTA_MCP_TOKEN</code> 与 <code>PTA_API_URL</code>。详情见 <code>docs/mcp-quickstart.md</code>。</li>
        </ul>
        <p class="mcp-info-tip">
          <strong>Token 仅在生成时返回一次</strong>。请立即保存到密码管理器；后续只能重新生成。
        </p>
      </section>

      <section class="cc-card mcp-table-card">
        <h2>Token 列表</h2>
        <table v-if="items.length" class="mcp-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>前缀</th>
              <th>权限</th>
              <th>最近使用</th>
              <th>创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <strong>{{ item.name }}</strong>
                <small v-if="item.notes">{{ item.notes }}</small>
              </td>
              <td><code>{{ item.tokenPrefix }}…</code></td>
              <td>
                <span :class="['mcp-badge', item.allowWrites ? 'write' : 'read']">
                  {{ item.allowWrites ? '读写' : '只读' }}
                </span>
                <span :class="['mcp-badge', item.enabled ? 'on' : 'off']">
                  {{ item.enabled ? '已启用' : '已停用' }}
                </span>
              </td>
              <td>{{ formatDate(item.lastUsedAt) }}</td>
              <td>{{ formatDate(item.createdAt) }}</td>
              <td class="mcp-table-actions">
                <button type="button" class="text-button" @click="toggleEnabled(item)">
                  {{ item.enabled ? '停用' : '启用' }}
                </button>
                <button
                  type="button"
                  class="text-button danger"
                  @click="confirmDelete(item)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else-if="loading" class="empty-tip">加载中…</div>
        <div v-else class="empty-tip">尚无 Token，点击右上角「生成新 Token」开始。</div>
      </section>
    </section>

    <div v-if="showCreateDialog" class="mcp-modal-backdrop" @click.self="cancelCreate">
      <div class="mcp-modal">
        <h3>生成新 MCP Token</h3>
        <label class="mcp-field">
          <span>名称（1-64 字）</span>
          <input v-model="createForm.name" maxlength="64" placeholder="例如：Claude Desktop" />
        </label>
        <label class="mcp-field">
          <input v-model="createForm.allowWrites" type="checkbox" />
          <span>允许写入（创建任务、推送/删除种子、签到站点等）</span>
        </label>
        <label class="mcp-field">
          <span>备注（可选）</span>
          <input v-model="createForm.notes" maxlength="120" placeholder="绑定到哪个 Agent / 电脑" />
        </label>
        <div class="mcp-modal-actions">
          <button type="button" class="text-button" @click="cancelCreate">取消</button>
          <button type="button" class="primary-button" @click="submitCreate">生成</button>
        </div>
      </div>
    </div>

    <div v-if="createdPlaintext" class="mcp-modal-backdrop" @click.self="dismissCreated">
      <div class="mcp-modal">
        <h3>Token 已生成</h3>
        <p class="mcp-warning">
          <strong>请立即复制下方 Token</strong>，关闭弹窗后<strong>不会</strong>再显示。
        </p>
        <pre class="mcp-plaintext"><code>{{ createdPlaintext }}</code></pre>
        <div class="mcp-modal-actions">
          <button type="button" class="text-button" @click="copyPlaintext">复制</button>
          <button type="button" class="primary-button" @click="dismissCreated">我已保存</button>
        </div>
      </div>
    </div>

    <div v-if="toDelete" class="mcp-modal-backdrop" @click.self="toDelete = null">
      <div class="mcp-modal">
        <h3>删除 Token？</h3>
        <p>确定要删除 Token「{{ toDelete.name }}」？删除后使用该 Token 的 Agent 将立即无法访问。</p>
        <div class="mcp-modal-actions">
          <button type="button" class="text-button" @click="toDelete = null">取消</button>
          <button type="button" class="primary-button danger" @click="performDelete">确认删除</button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppLayout from '../components/AppLayout.vue'
import CCPageHeader from '../components/CCPageHeader.vue'
import {
  createMcpToken,
  deleteMcpToken,
  listMcpTokens,
  updateMcpToken,
  type McpTokenPublic
} from '../api/mcpTokens'

const items = ref<McpTokenPublic[]>([])
const loading = ref(false)
const creating = ref(false)
const error = ref<string | null>(null)
const showCreateDialog = ref(false)
const createdPlaintext = ref<string | null>(null)
const toDelete = ref<McpTokenPublic | null>(null)
const createForm = ref({
  name: '',
  allowWrites: false,
  notes: ''
})

function formatDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const result = await listMcpTokens()
    items.value = result.items
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  createForm.value = { name: '', allowWrites: false, notes: '' }
  showCreateDialog.value = true
}

function cancelCreate() {
  showCreateDialog.value = false
}

async function submitCreate() {
  if (!createForm.value.name.trim()) {
    error.value = 'Token 名称不能为空'
    return
  }
  creating.value = true
  error.value = null
  try {
    const result = await createMcpToken({
      name: createForm.value.name.trim(),
      allowWrites: createForm.value.allowWrites,
      notes: createForm.value.notes.trim() || undefined
    })
    createdPlaintext.value = result.plaintext
    showCreateDialog.value = false
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '生成失败'
  } finally {
    creating.value = false
  }
}

function dismissCreated() {
  createdPlaintext.value = null
}

async function copyPlaintext() {
  if (!createdPlaintext.value) return
  try {
    await navigator.clipboard.writeText(createdPlaintext.value)
  } catch {
    // ignore
  }
}

async function toggleEnabled(item: McpTokenPublic) {
  try {
    await updateMcpToken(item.id, { enabled: !item.enabled })
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '更新失败'
  }
}

function confirmDelete(item: McpTokenPublic) {
  toDelete.value = item
}

async function performDelete() {
  if (!toDelete.value) return
  const id = toDelete.value.id
  toDelete.value = null
  try {
    await deleteMcpToken(id)
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '删除失败'
  }
}

onMounted(load)
</script>

<style scoped>
.mcp-tokens-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.mcp-info-card,
.mcp-table-card {
  padding: 20px;
}
.mcp-info-list {
  margin: 8px 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcp-info-tip {
  margin-top: 8px;
  color: var(--color-warning, #b45309);
}
.mcp-table {
  width: 100%;
  border-collapse: collapse;
}
.mcp-table th,
.mcp-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-divider, #e5e7eb);
  text-align: left;
  font-size: 14px;
}
.mcp-table th {
  font-weight: 600;
  color: var(--color-text-secondary, #6b7280);
}
.mcp-table small {
  display: block;
  color: var(--color-text-secondary, #6b7280);
  margin-top: 2px;
}
.mcp-table-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.mcp-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  margin-right: 4px;
}
.mcp-badge.read { background: #e0f2fe; color: #075985; }
.mcp-badge.write { background: #fef3c7; color: #92400e; }
.mcp-badge.on { background: #dcfce7; color: #166534; }
.mcp-badge.off { background: #fee2e2; color: #991b1b; }
.mcp-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.mcp-modal {
  background: var(--color-surface, #fff);
  border-radius: 12px;
  padding: 24px;
  width: 480px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mcp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}
.mcp-field input[type='text'],
.mcp-field input:not([type]) {
  padding: 8px 10px;
  border: 1px solid var(--color-divider, #d4d4d8);
  border-radius: 6px;
}
.mcp-field:has(input[type='checkbox']) {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.mcp-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.mcp-plaintext {
  background: #0f172a;
  color: #f1f5f9;
  padding: 12px;
  border-radius: 6px;
  word-break: break-all;
  font-size: 13px;
  max-height: 160px;
  overflow: auto;
}
.mcp-warning {
  color: #b45309;
}
.text-button.danger { color: #dc2626; }
.primary-button.danger { background: #dc2626; border-color: #dc2626; }
.error-banner {
  background: #fef2f2;
  color: #991b1b;
  padding: 12px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>