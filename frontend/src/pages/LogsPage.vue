<template>
  <AppLayout>
    <CCPageHeader
      eyebrow="运行记录"
      title="日志"
      description="查看系统操作、任务运行、调度、签到、种子与通知发送结果。"
      :meta="lastUpdatedAt ? `最近更新：${lastUpdatedAt}` : undefined"
    >
      <template #actions>
        <button
          class="secondary-button compact"
          type="button"
          :disabled="loading || exporting"
          @click="downloadLogs"
        >
          {{ exporting ? "导出中..." : `导出${activeTypeText}` }}
        </button>
        <button
          class="secondary-button compact danger-button"
          type="button"
          :disabled="loading || clearing || total === 0"
          @click="clearCurrentLogs"
        >
          {{ clearing ? "清空中..." : `清空${activeTypeText}` }}
        </button>
        <button
          class="primary-button compact"
          type="button"
          :disabled="loading"
          @click="loadLogs"
        >
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
      </template>
    </CCPageHeader>

    <div v-if="error" class="error-banner">
      {{ error }}
      <button type="button" @click="loadLogs">重试</button>
    </div>

    <section class="cc-card cc-list-surface logs-panel">
      <div class="logs-toolbar">
        <div class="log-source-nav" role="tablist" aria-label="日志来源">
          <button
            type="button"
            :class="{ active: activeType === 'operation' }"
            @click="switchType('operation')"
          >
            操作日志
          </button>
          <button
            type="button"
            :class="{ active: activeType === 'task' }"
            @click="switchType('task')"
          >
            任务日志
          </button>
          <button
            type="button"
            :class="{ active: activeType === 'schedule' }"
            @click="switchType('schedule')"
          >
            定时日志
          </button>
          <button
            type="button"
            :class="{ active: activeType === 'signin' }"
            @click="switchType('signin')"
          >
            签到日志
          </button>
          <button
            type="button"
            :class="{ active: activeType === 'torrent' }"
            @click="switchType('torrent')"
          >
            种子日志
          </button>
          <button type="button" :class="{ active: activeType === 'notification' }" @click="switchType('notification')">通知日志</button>
        </div>
        <label class="log-mobile-source">
          <span>日志分类</span>
          <select :value="activeType" @change="onMobileTypeChange">
            <option value="operation">操作日志</option>
            <option value="task">任务日志</option>
            <option value="schedule">定时日志</option>
            <option value="signin">签到日志</option>
            <option value="torrent">种子日志</option>
            <option value="notification">通知日志</option>
          </select>
        </label>
        <span>{{ loading ? "加载中..." : `${total} 条记录` }}</span>
      </div>

      <CCStateView
        v-if="loading"
        title="日志加载中..."
        :description="`正在读取${activeTypeText}，请稍候。`"
        tone="loading"
      />
      <div v-else-if="items.length" class="log-list">
        <article v-for="item in items" :key="item.id" class="log-row">
          <div class="log-meta">
            <time>{{ formatTime(item.createdAt) }}</time>
            <span class="status-badge" :class="item.status.toLowerCase()">{{
              statusText(item.status)
            }}</span>
          </div>
          <div>
            <strong>{{ primaryText(item) }}</strong>
            <p>{{ item.message }}</p>
            <div v-if="failureDetails(item).length" class="log-details">
              <span v-for="detail in failureDetails(item)" :key="detail">{{
                detail
              }}</span>
            </div>
            <small>{{ secondaryText(item) }}</small>
          </div>
        </article>
      </div>
      <CCStateView
        v-else
        :title="emptyText"
        description="切换分类或刷新后再查看。"
      />

      <div v-if="!loading" class="pager">
        <button
          type="button"
          :disabled="page <= 1 || loading"
          @click="changePage(page - 1)"
        >
          上一页
        </button>
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <button
          type="button"
          :disabled="page >= totalPages || loading"
          @click="changePage(page + 1)"
        >
          下一页
        </button>
      </div>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import AppLayout from "../components/AppLayout.vue";
import CCPageHeader from "../components/CCPageHeader.vue";
import CCStateView from "../components/CCStateView.vue";
import {
  clearLogs,
  exportLogs,
  getLogs,
  type LogType,
  type NotificationLog,
  type OperationLog,
  type ScheduleLog,
  type SigninLog,
  type TaskLog,
  type TorrentLog,
} from "../api/logs";

const route = useRoute();
const initialType: LogType =
  route.query.type === "task"
    ? "task"
    : route.query.type === "schedule"
      ? "schedule"
      : route.query.type === "signin"
        ? "signin"
        : route.query.type === "torrent"
          ? "torrent"
          : route.query.type === "notification"
            ? "notification"
            : "operation";
const activeType = ref<LogType>(initialType);
const operationLogs = ref<OperationLog[]>([]);
const taskLogs = ref<TaskLog[]>([]);
const scheduleLogs = ref<ScheduleLog[]>([]);
const signinLogs = ref<SigninLog[]>([]);
const torrentLogs = ref<TorrentLog[]>([]);
const notificationLogs = ref<NotificationLog[]>([]);
const loading = ref(false);
const exporting = ref(false);
const clearing = ref(false);
const error = ref("");
const lastUpdatedAt = ref("");
const page = ref(1);
const pageSize = 20;
const total = ref(0);
let loadRequestId = 0;

const items = computed(() => {
  if (activeType.value === "operation") return operationLogs.value;
  if (activeType.value === "schedule") return scheduleLogs.value;
  if (activeType.value === "signin") return signinLogs.value;
  if (activeType.value === "torrent") return torrentLogs.value;
  if (activeType.value === "notification") return notificationLogs.value;
  return taskLogs.value;
});
const totalPages = computed(() =>
  Math.max(Math.ceil(total.value / pageSize), 1),
);
const activeTypeText = computed(() => {
  if (activeType.value === "operation") return "操作日志";
  if (activeType.value === "schedule") return "定时日志";
  if (activeType.value === "signin") return "签到日志";
  if (activeType.value === "torrent") return "种子日志";
  if (activeType.value === "notification") return "通知日志";
  return "任务日志";
});
const emptyText = computed(() => `暂无${activeTypeText.value}。`);

function switchType(type: LogType) {
  if (activeType.value === type) {
    return;
  }
  activeType.value = type;
  page.value = 1;
  loadLogs();
}

function onMobileTypeChange(event: Event) {
  switchType((event.target as HTMLSelectElement).value as LogType);
}

function changePage(nextPage: number) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value);
  loadLogs();
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}

function formatDuration(ms?: number) {
  if (ms === undefined) return "";
  if (ms < 1000) return `${ms}毫秒`;
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);
  return parts.join("");
}

function statusText(
  status:
    | OperationLog["status"]
    | TaskLog["status"]
    | ScheduleLog["status"]
    | SigninLog["status"]
    | NotificationLog["status"],
) {
  const map = {
    SUCCESS: "成功",
    FAILED: "失败",
    RUNNING: "运行中",
    SKIPPED: "已跳过",
  } as const;
  return map[status as keyof typeof map] ?? status;
}

function primaryText(
  item: OperationLog | TaskLog | ScheduleLog | SigninLog | TorrentLog | NotificationLog,
) {
  if (item.type === "OPERATION") return item.action;
  if (item.type === "SCHEDULE") return scheduleJobText(item.jobName);
  if (item.type === "SIGNIN") return item.siteName;
  if (item.type === "TORRENT") return torrentEventText(item.event);
  if (item.type === "NOTIFICATION") return `${notificationEventText(item.event)} · ${item.configName}`;
  return item.taskName;
}

function secondaryText(
  item: OperationLog | TaskLog | ScheduleLog | SigninLog | TorrentLog | NotificationLog,
) {
  if (item.type === "TASK") {
    return [
      item.taskId ? `任务 ID：${item.taskId}` : "系统任务",
      item.runMode ? `来源：${runModeText(item.runMode)}` : "",
      item.startedAt ? `开始：${formatTime(item.startedAt)}` : "",
      item.finishedAt ? `结束：${formatTime(item.finishedAt)}` : "",
      taskResultText(item),
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (item.type === "SCHEDULE") {
    return [
      item.startedAt ? `开始：${formatTime(item.startedAt)}` : "",
      item.finishedAt ? `结束：${formatTime(item.finishedAt)}` : "",
      item.durationMs === undefined
        ? ""
        : `耗时：${formatDuration(item.durationMs)}`,
      item.summary ? `摘要：${item.summary}` : "",
      item.errorMessage ? `错误：${item.errorMessage}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (item.type === "SIGNIN") {
    return [
      `来源：${item.runMode === "AUTO" ? "自动" : "手动"}`,
      item.triggerSource === "manual-button"
        ? "触发：手动按钮"
        : "触发：调度器",
      `开始：${formatTime(item.startedAt)}`,
      item.finishedAt ? `结束：${formatTime(item.finishedAt)}` : "",
      item.durationMs === undefined
        ? ""
        : `耗时：${formatDuration(item.durationMs)}`,
      item.errorMessage ? `错误：${item.errorMessage}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (item.type === "TORRENT") {
    return [
      item.siteName ? `站点：${item.siteName}` : "",
      item.source ? `来源：${torrentSourceText(item.source)}` : "",
      item.reason ? `原因：${item.reason}` : "",
      item.actorName ? `操作者：${item.actorName}` : "",
    ]
      .filter(Boolean)
      .join(" / ");
  }
  if (item.type === "NOTIFICATION") {
    return [
      `渠道：爱语飞飞`,
      item.httpStatus === undefined ? "" : `HTTP：${item.httpStatus}`,
      item.providerCode === undefined ? "" : `响应码：${item.providerCode}`,
      item.providerMessage ? `渠道消息：${item.providerMessage}` : "",
      item.durationMs === undefined ? "" : `耗时：${formatDuration(item.durationMs)}`,
    ].filter(Boolean).join(" / ");
  }
  return [
    item.actorName ? `操作者：${item.actorName}` : "操作者：未知",
    item.ip ? `IP：${item.ip}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

function scheduleJobText(jobName: string) {
  const map: Record<string, string> = {
    "task-auto-run-scan": "自动任务扫描",
    "task-auto-run": "自动任务执行",
    "torrent-download-stats-sync": "种子下载器状态同步",
    "expired-free-download-cleanup": "下载器自动清理",
    "site-traffic-sync": "站点流量统计同步",
    "site-auto-signin": "站点自动签到",
  };
  return map[jobName] ?? jobName;
}

function torrentEventText(event: TorrentLog["event"]) {
  const map: Record<TorrentLog["event"], string> = {
    INSERTED: "种子入库",
    PUSHED: "推送下载器",
    PUSH_FAILED: "推送失败",
    AUTO_DELETE_TASK: "自动删除任务",
    MANUAL_DELETE_TASK: "手动删除任务",
    MANUAL_RESET_TASK: "手动重置任务",
    DELETE_RECORD: "删除种子记录",
    UPDATE_SETTINGS: "修改种子设置",
  };
  return map[event] ?? event;
}

function torrentSourceText(source: NonNullable<TorrentLog["source"]>) {
  const map: Record<NonNullable<TorrentLog["source"]>, string> = {
    AUTO: "自动",
    MANUAL: "手动",
    SCHEDULER: "调度器",
    TASK: "任务",
  };
  return map[source] ?? source;
}

function notificationEventText(event: NotificationLog["event"]) {
  const map: Record<NotificationLog["event"], string> = {
    SITE_SIGNIN: "站点签到",
    TASK_TRIGGERED: "任务触发",
    TORRENT_ADDED: "种子添加",
    TORRENT_DELETED: "种子删除",
    TEST: "测试通知",
  };
  return map[event];
}

function runModeText(mode: NonNullable<TaskLog["runMode"]>) {
  const map = {
    AUTO: "自动执行",
    MANUAL_RUN: "手动运行",
  };
  return map[mode];
}

function taskResultText(item: TaskLog) {
  const parts = [
    item.fetchedCount === undefined ? "" : `抓取：${item.fetchedCount}`,
    item.skippedExistingCount === undefined
      ? ""
      : `去重：${item.skippedExistingCount}`,
    item.matchedCount === undefined ? "" : `命中：${item.matchedCount}`,
    item.pushedCount === undefined ? "" : `推送成功：${item.pushedCount}`,
    item.pushFailedCount === undefined
      ? ""
      : `推送失败：${item.pushFailedCount}`,
  ].filter(Boolean);
  return parts.join("，");
}

function failureDetails(
  item: OperationLog | TaskLog | ScheduleLog | SigninLog | TorrentLog | NotificationLog,
) {
  if (item.type === "SCHEDULE") {
    return item.details ? [JSON.stringify(item.details)] : [];
  }
  if (item.type === "SIGNIN") {
    return item.errorMessage ? [`签到失败：${item.errorMessage}`] : [];
  }
  if (item.type === "TORRENT") {
    return item.reason ? [`原因：${item.reason}`] : [];
  }
  if (item.type === "NOTIFICATION") {
    return item.errorMessage ? [`发送失败：${item.errorMessage}`] : [];
  }
  if (item.type !== "TASK") return [];
  const details = [
    ...(item.failureDetails ?? []),
    item.fetchErrorMessage ? `抓取失败：${item.fetchErrorMessage}` : "",
    ...(item.pushErrorMessages ?? []),
  ].filter(Boolean);
  return [...new Set(details)].slice(0, 4);
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function downloadLogs() {
  exporting.value = true;
  error.value = "";
  try {
    const result = await exportLogs(activeType.value);
    saveBlob(result.blob, result.filename);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "日志导出失败";
  } finally {
    exporting.value = false;
  }
}

async function clearCurrentLogs() {
  if (!window.confirm(`确认清空当前 ${activeTypeText.value}？此操作不可恢复。`))
    return;
  clearing.value = true;
  error.value = "";
  try {
    await clearLogs(activeType.value);
    page.value = 1;
    await loadLogs();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "日志清空失败";
  } finally {
    clearing.value = false;
  }
}

async function loadLogs() {
  const requestId = ++loadRequestId;
  const requestedType = activeType.value;
  const requestedPage = page.value;
  loading.value = true;
  error.value = "";
  try {
    if (requestedType === "operation") {
      const result = await getLogs("operation", requestedPage, pageSize);
      if (requestId !== loadRequestId) return;
      operationLogs.value = result.items;
      total.value = result.total;
    } else if (requestedType === "schedule") {
      const result = await getLogs("schedule", requestedPage, pageSize);
      if (requestId !== loadRequestId) return;
      scheduleLogs.value = result.items;
      total.value = result.total;
    } else if (requestedType === "signin") {
      const result = await getLogs("signin", requestedPage, pageSize);
      if (requestId !== loadRequestId) return;
      signinLogs.value = result.items;
      total.value = result.total;
    } else if (requestedType === "torrent") {
      const result = await getLogs("torrent", requestedPage, pageSize);
      if (requestId !== loadRequestId) return;
      torrentLogs.value = result.items;
      total.value = result.total;
    } else if (requestedType === "notification") {
      const result = await getLogs("notification", requestedPage, pageSize);
      if (requestId !== loadRequestId) return;
      notificationLogs.value = result.items;
      total.value = result.total;
    } else {
      const result = await getLogs("task", requestedPage, pageSize);
      if (requestId !== loadRequestId) return;
      taskLogs.value = result.items;
      total.value = result.total;
    }
    lastUpdatedAt.value = new Date().toLocaleString("zh-CN");
  } catch (err) {
    if (requestId !== loadRequestId) return;
    error.value = err instanceof Error ? err.message : "日志加载失败";
  } finally {
    if (requestId === loadRequestId) loading.value = false;
  }
}

onMounted(loadLogs);
</script>
