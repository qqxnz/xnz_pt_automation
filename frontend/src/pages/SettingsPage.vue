<template>
  <AppLayout>
    <section class="settings-page">
      <CCPageHeader
        eyebrow="系统设置"
        title="系统设置"
        description="管理密码、系统信息与数据库备份恢复。"
        meta="系统信息已同步"
      >
        <template #actions>
          <button
            class="primary-button compact"
            type="button"
            @click="openPasswordDialog"
          >
            修改密码
          </button>
        </template>
      </CCPageHeader>

      <div v-if="infoError" class="error-banner">
        {{ infoError }}
        <button type="button" @click="loadAll">重试</button>
      </div>

      <nav class="cc-settings-mobile-nav" aria-label="系统设置分区">
        <button type="button" @click="scrollToSettingsSection('info')">
          <strong>系统信息</strong><span>版本、数据库与存储目录</span
          ><i class="success">正常</i>
        </button>
        <button type="button" @click="scrollToSettingsSection('backup')">
          <strong>数据库备份</strong><span>自动备份、恢复与删除</span
          ><i>配置</i>
        </button>
      </nav>

      <section
        ref="infoSection"
        class="cc-card settings-card settings-info-card"
      >
        <div class="panel-title-row">
          <div>
            <h2>系统信息</h2>
            <p>版本、运行环境、数据库和存储目录</p>
          </div>
          <div class="settings-info-actions">
            <span>{{ loadingInfo ? "加载中..." : "运行中" }}</span>
          </div>
        </div>
        <div v-if="systemInfo" class="system-info-sections">
          <section
            v-for="group in systemInfoGroups"
            :key="group.title"
            class="system-info-group"
          >
            <h3>{{ group.title }}</h3>
            <div class="settings-info-grid">
              <article
                v-for="item in group.items"
                :key="item.label"
                :class="{ 'path-info-item': item.copyable }"
              >
                <span>{{ item.label }}</span>
                <strong :title="item.value">{{ item.value }}</strong>
                <button
                  v-if="item.copyable"
                  class="text-button"
                  type="button"
                  :aria-label="`复制${item.label}`"
                  @click="copySystemValue(item.value)"
                >
                  复制
                </button>
              </article>
            </div>
          </section>
        </div>
        <div v-else-if="loadingInfo" class="empty-tip">系统信息加载中...</div>
        <div v-else class="empty-tip">暂时无法获取系统信息。</div>
      </section>

      <section class="cc-card settings-card" ref="backupSection">
        <div class="panel-title-row">
          <h2>数据库备份</h2>
          <span>{{ loadingBackups ? "加载中..." : "读取 dataDir 目录" }}</span>
        </div>

        <div class="settings-info-grid backup-summary">
          <article>
            <span>数据目录</span>
            <strong>{{ backupDataDir || "-" }}</strong>
          </article>
          <article>
            <span>备份目录</span>
            <strong>{{ backupDir || "-" }}</strong>
          </article>
          <article>
            <span>最近一次备份</span>
            <strong>{{ lastBackupAtText }}</strong>
          </article>
          <article>
            <span>下次自动备份</span>
            <strong>{{ nextAutoBackupText }}</strong>
          </article>
          <article>
            <span>备份文件数量</span>
            <strong>{{ backups.length }}</strong>
          </article>
        </div>

        <div class="backup-tip">
          系统每天凌晨 03:00
          自动备份数据库；备份文件可直接移出本目录以节省空间，再点击"刷新"即可从列表中隐藏；移回
          dataDir 会自动重新出现。
        </div>

        <div class="backup-actions">
          <button
            class="primary-button compact"
            type="button"
            :disabled="creatingBackup || !!restoringName"
            @click="runBackupNow"
          >
            {{ creatingBackup ? "生成中..." : "立即备份" }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="loadingBackups || creatingBackup"
            @click="loadBackups"
          >
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
          <div
            v-for="item in backups"
            :key="item.name"
            class="backup-table-row"
          >
            <span class="backup-name" :title="item.name">{{ item.name }}</span>
            <span>{{ formatBytes(item.sizeBytes) }}</span>
            <span :title="item.mtime">{{ formatDate(item.mtime) }}</span>
            <span class="backup-row-actions">
              <button
                class="text-button"
                type="button"
                :disabled="downloadingName === item.name"
                @click="downloadBackup(item.name)"
              >
                {{ downloadingName === item.name ? "下载中..." : "下载" }}
              </button>
              <button
                class="text-button danger"
                type="button"
                :disabled="!!restoringName || deletingName === item.name"
                @click="confirmRestore(item.name)"
              >
                {{ restoringName === item.name ? "恢复中..." : "恢复" }}
              </button>
              <button
                class="text-button"
                type="button"
                :disabled="!!restoringName || deletingName === item.name"
                @click="removeBackup(item.name)"
              >
                {{ deletingName === item.name ? "删除中..." : "删除" }}
              </button>
            </span>
          </div>
        </div>
        <div v-else class="empty-tip backup-empty">
          暂无备份文件，将 db-*.sqlite3 放入 dataDir 后点击「刷新」即可显示。
        </div>
      </section>

      <div
        v-if="passwordDialogOpen"
        class="cc-modal-backdrop modal-backdrop"
        role="presentation"
        @click.self="closePasswordDialog"
      >
        <form
          class="cc-form-dialog site-form settings-password-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-dialog-title"
          @submit.prevent="submitPassword"
        >
          <header class="cc-form-head">
            <div>
              <span>账号安全</span>
              <h2 id="password-dialog-title">修改管理员密码</h2>
              <p>新密码需为 8–64 位，并至少包含一个字母和一个数字。</p>
            </div>
            <button
              type="button"
              class="icon-button"
              aria-label="关闭修改密码弹窗"
              :disabled="changingPassword"
              @click="closePasswordDialog"
            >
              ×
            </button>
          </header>
          <div class="cc-form-body settings-form">
            <label
              >旧密码<input
                v-model="passwordForm.oldPassword"
                :disabled="changingPassword"
                type="password"
                autocomplete="current-password"
            /></label>
            <label
              >新密码<input
                v-model="passwordForm.newPassword"
                :disabled="changingPassword"
                type="password"
                autocomplete="new-password"
            /></label>
            <label
              >确认新密码<input
                v-model="passwordForm.confirmPassword"
                :disabled="changingPassword"
                type="password"
                autocomplete="new-password"
            /></label>
          </div>
          <footer class="cc-form-foot">
            <span>修改成功后当前会话保持有效</span>
            <div>
              <button
                class="secondary-button"
                type="button"
                :disabled="changingPassword"
                @click="closePasswordDialog"
              >
                取消
              </button>
              <button
                class="primary-button"
                type="submit"
                :disabled="changingPassword"
              >
                {{ changingPassword ? "提交中..." : "确认修改" }}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { Dialog, Snackbar } from "@varlet/ui";
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import AppLayout from "../components/AppLayout.vue";
import CCPageHeader from "../components/CCPageHeader.vue";
import {
  deleteBackup as apiDeleteBackup,
  listBackups as apiListBackups,
  restoreBackup as apiRestoreBackup,
  runBackup as apiRunBackup,
  triggerBrowserDownload,
  type BackupItem,
} from "../api/backup";
import {
  changePassword,
  getSystemInfo,
  type SystemInfo,
} from "../api/settings";

const route = useRoute();
const loadingInfo = ref(false);
const changingPassword = ref(false);
const passwordDialogOpen = ref(false);
const infoError = ref("");
const systemInfo = ref<SystemInfo>();
const backupSection = ref<HTMLElement>();
const infoSection = ref<HTMLElement>();

function scrollToSettingsSection(section: "info" | "backup") {
  const target =
    section === "info" ? infoSection.value : backupSection.value;
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}
const backups = ref<BackupItem[]>([]);
const backupDataDir = ref("");
const backupDir = ref("");
const backupLastAt = ref<string>();
const backupNextAutoAt = ref<string>();
const loadingBackups = ref(false);
const backupError = ref("");
const creatingBackup = ref(false);
const downloadingName = ref<string>();
const deletingName = ref<string>();
const restoringName = ref<string>();

const passwordForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

function openPasswordDialog() {
  passwordDialogOpen.value = true;
}

function closePasswordDialog() {
  if (changingPassword.value) return;
  passwordDialogOpen.value = false;
  Object.assign(passwordForm, {
    oldPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
}

const systemInfoGroups = computed(() => {
  const info = systemInfo.value;
  if (!info) return [];
  return [
    {
      title: "运行环境",
      items: [
        { label: "系统版本", value: info.version },
        { label: "运行环境", value: info.runtimeEnv },
        { label: "Node.js", value: info.nodeVersion },
        { label: "启动时间", value: formatDate(info.startedAt) },
        { label: "系统时区", value: info.timezone },
      ],
    },
    {
      title: "数据库",
      items: [
        { label: "数据库类型", value: info.database.type },
        { label: "数据库路径", value: info.database.path, copyable: true },
        { label: "数据库大小", value: formatBytes(info.database.sizeBytes) },
        { label: "Schema 版本", value: info.database.schemaVersion },
        {
          label: "最近迁移结果",
          value: migrationText(info.database.lastMigrationStatus),
        },
      ],
    },
    {
      title: "存储目录",
      items: [
        { label: "数据目录", value: info.paths.dataDir || "-", copyable: true },
        { label: "日志目录", value: info.paths.logDir || "-", copyable: true },
        {
          label: "缓存目录",
          value: info.paths.cacheDir || "-",
          copyable: true,
        },
        {
          label: "备份目录",
          value: info.paths.backupDir || "-",
          copyable: true,
        },
      ],
    },
  ];
});

async function copySystemValue(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    Snackbar.success("路径已复制");
  } catch {
    Snackbar.error("复制失败，请手动选择文本");
  }
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(value?: number) {
  if (value === undefined) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: unitIndex ? 2 : 0 }).format(size)} ${units[unitIndex]}`;
}

function migrationText(value?: SystemInfo["database"]["lastMigrationStatus"]) {
  if (value === "FAILED") return "失败";
  if (value === "PENDING") return "待执行";
  return "正常";
}

async function loadInfo() {
  loadingInfo.value = true;
  infoError.value = "";
  try {
    systemInfo.value = await getSystemInfo();
  } catch (err) {
    infoError.value = err instanceof Error ? err.message : "系统信息加载失败";
  } finally {
    loadingInfo.value = false;
  }
}

async function loadAll() {
  await Promise.all([loadInfo(), loadBackups()]);
}

async function loadBackups() {
  loadingBackups.value = true;
  backupError.value = "";
  try {
    const result = await apiListBackups();
    backups.value = result.backups;
    backupDataDir.value = result.dataDir;
    backupDir.value = result.backupDir;
    backupLastAt.value = result.lastBackupAt;
    backupNextAutoAt.value = result.nextAutoBackupAt;
  } catch (err) {
    backupError.value = err instanceof Error ? err.message : "备份列表加载失败";
  } finally {
    loadingBackups.value = false;
  }
}

const lastBackupAtText = computed(() =>
  backupLastAt.value ? formatDate(backupLastAt.value) : "尚未生成",
);
const nextAutoBackupText = computed(() =>
  backupNextAutoAt.value ? formatDate(backupNextAutoAt.value) : "--",
);

async function runBackupNow() {
  creatingBackup.value = true;
  try {
    const result = await apiRunBackup();
    Snackbar.success(`已生成备份：${result.backup.name}`);
    await loadBackups();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "备份失败");
  } finally {
    creatingBackup.value = false;
  }
}

async function downloadBackup(name: string) {
  downloadingName.value = name;
  try {
    await triggerBrowserDownload(name);
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "下载失败");
  } finally {
    downloadingName.value = undefined;
  }
}

async function removeBackup(name: string) {
  const confirmed = window.confirm(`确认删除备份 ${name} 吗？此操作不可撤销。`);
  if (!confirmed) return;
  deletingName.value = name;
  try {
    await apiDeleteBackup(name);
    Snackbar.success(`已删除：${name}`);
    await loadBackups();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "删除失败");
  } finally {
    deletingName.value = undefined;
  }
}

function confirmRestore(name: string) {
  Dialog({
    title: "确认恢复数据库",
    message: `将把当前数据库替换为备份 ${name}，并自动重启 PM2 / Docker 实例（检测到哪种就哪种）。继续吗？`,
    onConfirm: async () => {
      restoringName.value = name;
      try {
        const result = await apiRestoreBackup(name);
        Dialog({
          title: "恢复成功",
          message: `${result.message}（运行时：${result.runtime}），约 1-2 秒后会自动重新加载页面…`,
          onClose: () => undefined,
        });
        setTimeout(() => window.location.reload(), 2000);
      } catch (err) {
        const message = err instanceof Error ? err.message : "恢复失败";
        if (
          message.includes("已被移走") ||
          message.includes("BACKUP_NOT_FOUND")
        ) {
          await loadBackups();
          Snackbar.warning("备份文件已不在数据目录，恢复已取消。");
        } else {
          Snackbar.error(message);
        }
        restoringName.value = undefined;
      }
    },
  });
}

function validatePasswordForm() {
  if (!passwordForm.oldPassword) return "旧密码必填";
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(passwordForm.newPassword))
    return "新密码需为 8-64 位，且至少包含字母和数字";
  if (passwordForm.oldPassword === passwordForm.newPassword)
    return "新密码不能与旧密码相同";
  if (passwordForm.newPassword !== passwordForm.confirmPassword)
    return "两次新密码不一致";
  return "";
}

async function submitPassword() {
  const error = validatePasswordForm();
  if (error) {
    Snackbar.warning(error);
    return;
  }
  changingPassword.value = true;
  try {
    await changePassword({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
    Object.assign(passwordForm, {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    });
    passwordDialogOpen.value = false;
    Snackbar.success("密码已更新");
    await loadInfo();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "密码修改失败");
  } finally {
    changingPassword.value = false;
  }
}

async function focusSection() {
  await nextTick();
  const section = String(route.query.section ?? "");
  if (section === "password") {
    openPasswordDialog();
    return;
  }
  const target = section === "backup" ? backupSection.value : infoSection.value;
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

onMounted(async () => {
  await loadAll();
  if (route.query.section) await focusSection();
});
</script>

<style scoped>
.backup-summary {
  grid-template-columns: repeat(4, minmax(0, 1fr));
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
  grid-template-columns:
    minmax(0, 2.4fr) minmax(0, 0.8fr) minmax(0, 1.2fr)
    minmax(0, 1.4fr);
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
