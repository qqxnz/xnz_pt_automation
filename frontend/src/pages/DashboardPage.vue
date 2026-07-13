<template>
  <AppLayout>
    <section class="cc-dashboard">
      <CCPageHeader
        eyebrow="运行指挥台"
        :title="`${greeting}，${statusHeadline}`"
        description="集中查看 PT 站点、下载器和自动化任务的实时状态。"
        :meta="lastUpdatedAt ? `最近更新：${lastUpdatedAt}` : undefined"
      >
        <template #actions
          ><button
            class="cc-button is-primary"
            type="button"
            :disabled="loading"
            @click="loadOverview"
          >
            {{ loading ? "刷新中…" : "刷新" }}
          </button></template
        >
      </CCPageHeader>

      <div v-if="error" class="cc-error-banner">
        <span>!</span>
        <p>{{ error }}</p>
        <button type="button" @click="loadOverview">重试</button>
      </div>
      <CCStateView
        v-else-if="loading && !overview"
        title="正在汇总运行状态"
        description="正在读取站点、下载器、任务与流量数据。"
        tone="loading"
      />

      <template v-else>
        <section class="cc-runtime-strip" aria-label="运行摘要">
          <div class="cc-runtime-transfer">
            <span class="cc-runtime-label">实时传输</span>
            <div>
              <strong class="is-upload"
                >↑ {{ formatBytes(totalUploadSpeed, "/s") }}</strong
              ><strong>↓ {{ formatBytes(totalDownloadSpeed, "/s") }}</strong>
            </div>
            <router-link to="/downloaders"
              >{{ onlineDownloaderCount }} /
              {{ overview?.downloaders.items.length ?? 0 }} 个下载器在线
              →</router-link
            >
          </div>
          <div class="cc-runtime-health">
            <span class="cc-runtime-label">站点健康</span>
            <strong
              >{{ overview?.sites.online ?? 0 }}
              <small>/ {{ overview?.sites.total ?? 0 }} 在线</small></strong
            >
            <div class="cc-health-legend">
              <span class="online">在线 {{ overview?.sites.online ?? 0 }}</span
              ><span class="auth"
                >认证失败 {{ overview?.sites.authFailed ?? 0 }}</span
              ><span class="offline"
                >离线 {{ overview?.sites.offline ?? 0 }}</span
              >
            </div>
            <div class="cc-health-bar">
              <i
                class="online"
                :style="{ flex: overview?.sites.online || 0.001 }"
              /><i
                class="auth"
                :style="{ flex: overview?.sites.authFailed || 0 }"
              /><i
                class="offline"
                :style="{ flex: overview?.sites.offline || 0 }"
              /><i
                class="unknown"
                :style="{ flex: overview?.sites.unknown || 0 }"
              />
            </div>
          </div>
          <router-link
            class="cc-runtime-alert"
            :class="{ 'is-warning': attentionCount > 0 }"
            :to="attentionTarget"
            ><i>{{ attentionCount > 0 ? "!" : "✓" }}</i
            ><span
              ><strong>{{ attentionTitle }}</strong
              ><small>{{ attentionDescription }}</small></span
            ><b>›</b></router-link
          >
        </section>

        <section class="cc-dashboard-grid">
          <article class="cc-card cc-dashboard-card">
            <header class="cc-card-header">
              <div>
                <span class="cc-eyebrow">站点状态</span>
                <h2>站点与签到</h2>
              </div>
              <router-link to="/sites">查看站点 →</router-link>
            </header>
            <div class="cc-inline-metrics is-four">
              <div>
                <span>已配置</span
                ><strong>{{ overview?.sites.total ?? 0 }}</strong>
              </div>
              <div>
                <span>在线</span
                ><strong class="is-success">{{
                  overview?.sites.online ?? 0
                }}</strong>
              </div>
              <div>
                <span>今日已签到</span
                ><strong class="is-success">{{
                  overview?.sites.todaySigninSuccess ?? 0
                }}</strong>
              </div>
              <div>
                <span>待签到</span
                ><strong class="is-warning">{{
                  overview?.sites.todaySigninPending ?? 0
                }}</strong>
              </div>
            </div>
            <details class="cc-detail-disclosure">
              <summary>查看异常与完整签到状态</summary>
              <div class="cc-detail-values">
                <span
                  >认证失败 <b>{{ overview?.sites.authFailed ?? 0 }}</b></span
                ><span
                  >离线 <b>{{ overview?.sites.offline ?? 0 }}</b></span
                ><span
                  >签到失败
                  <b>{{ overview?.sites.todaySigninFailed ?? 0 }}</b></span
                ><span
                  >开启签到
                  <b>{{ overview?.sites.signinEnabled ?? 0 }}</b></span
                >
              </div>
            </details>
          </article>

          <article class="cc-card cc-dashboard-card">
            <header class="cc-card-header">
              <div>
                <span class="cc-eyebrow">实时状态</span>
                <h2>下载器</h2>
              </div>
              <router-link to="/downloaders">查看下载器 →</router-link>
            </header>
            <div
              v-if="overview?.downloaders.items.length"
              class="cc-data-list is-downloader"
            >
              <div class="cc-data-list-head">
                <span>名称</span><span>状态</span><span>上传</span
                ><span>下载</span>
              </div>
              <div
                v-for="downloader in overview.downloaders.items"
                :key="downloader.id"
                class="cc-data-list-row"
              >
                <strong>{{ downloader.name }}</strong
                ><CCStatusTag
                  :label="downloaderStatusMeta(displayStatus(downloader)).label"
                  :tone="downloaderTone(displayStatus(downloader))"
                /><span class="is-success">{{
                  formatBytes(displaySpeed(downloader.id, "upload"), "/s")
                }}</span
                ><span>{{
                  formatBytes(displaySpeed(downloader.id, "download"), "/s")
                }}</span>
                <small
                  v-if="statusById[downloader.id]?.message"
                  class="cc-downloader-error"
                  :title="statusById[downloader.id]?.message"
                  >{{ statusById[downloader.id]?.message }}</small
                >
              </div>
            </div>
            <CCStateView
              v-else
              title="暂无下载器"
              description="添加下载器后可查看实时传输状态。"
              ><router-link class="cc-button is-primary" to="/downloaders"
                >配置下载器</router-link
              ></CCStateView
            >
          </article>

          <article class="cc-card cc-dashboard-card">
            <header class="cc-card-header">
              <div>
                <span class="cc-eyebrow">资源概览</span>
                <h2>种子与流量</h2>
              </div>
              <router-link to="/statistics">查看流量 →</router-link>
            </header>
            <div class="cc-inline-metrics is-four">
              <div>
                <span>种子数量</span
                ><strong>{{ overview?.torrents.total ?? 0 }}</strong>
              </div>
              <div>
                <span>运行中</span
                ><strong class="is-success">{{
                  overview?.torrents.running ?? 0
                }}</strong>
              </div>
              <div>
                <span>总上传</span
                ><strong>{{
                  formatBytes(overview?.torrents.totalUploaded)
                }}</strong>
              </div>
              <div>
                <span>今日下载</span
                ><strong>{{
                  formatBytes(overview?.traffic.todayDownloaded)
                }}</strong>
              </div>
            </div>
            <details class="cc-detail-disclosure">
              <summary>查看完整流量数据</summary>
              <div class="cc-detail-values">
                <span
                  >未运行 <b>{{ overview?.torrents.notRunning ?? 0 }}</b></span
                ><span
                  >总下载
                  <b>{{
                    formatBytes(overview?.torrents.totalDownloaded)
                  }}</b></span
                ><span
                  >今日上传
                  <b>{{
                    formatBytes(overview?.traffic.todayUploaded)
                  }}</b></span
                ><span
                  >累计下载
                  <b>{{
                    formatBytes(overview?.traffic.downloadedTotal)
                  }}</b></span
                >
              </div>
            </details>
          </article>

          <article class="cc-card cc-dashboard-card">
            <header class="cc-card-header">
              <div>
                <span class="cc-eyebrow">执行记录</span>
                <h2>最近任务</h2>
              </div>
              <router-link to="/tasks">查看任务 →</router-link>
            </header>
            <div
              v-if="overview?.tasks.recent.length"
              class="cc-data-list is-jobs"
            >
              <div class="cc-data-list-head">
                <span>任务</span><span>状态</span><span>摘要</span
                ><span>时间</span>
              </div>
              <div
                v-for="job in overview.tasks.recent"
                :key="job.id ?? `${job.name}-${job.finishedAt ?? ''}`"
                class="cc-data-list-row"
              >
                <strong>{{ job.name }}</strong
                ><CCStatusTag
                  :label="jobStatusText(job.status)"
                  :tone="jobTone(job.status)"
                /><span>{{ job.summary || "-" }}</span
                ><time>{{ formatTime(job.createdAt) }}</time>
              </div>
            </div>
            <CCStateView
              v-else
              title="暂无最近任务"
              description="任务运行后会在这里显示最近结果。"
            />
          </article>

          <article class="cc-card cc-dashboard-card is-wide">
            <header class="cc-card-header">
              <div>
                <span class="cc-eyebrow">系统调度</span>
                <h2>后台任务调度</h2>
              </div>
              <span>{{ overview?.scheduler.jobs.length ?? 0 }} 个任务</span>
            </header>
            <div class="cc-data-list is-scheduler">
              <div class="cc-data-list-head">
                <span>任务名称</span><span>间隔</span><span>状态</span
                ><span>上次执行</span><span>下次运行</span>
              </div>
              <div
                v-for="job in overview?.scheduler.jobs"
                :key="job.name"
                class="cc-data-list-row"
              >
                <strong>{{ job.readableName }}</strong
                ><span>{{ formatInterval(job.intervalMs) }}</span
                ><CCStatusTag
                  :label="schedulerStatusText(job)"
                  :tone="schedulerTone(job)"
                /><span>{{ formatTime(job.lastRunAt) }}</span
                ><span>{{ formatTime(job.nextRunAt) }}</span>
              </div>
            </div>
          </article>
        </section>
      </template>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import AppLayout from "../components/AppLayout.vue";
import CCPageHeader from "../components/CCPageHeader.vue";
import CCStateView from "../components/CCStateView.vue";
import CCStatusTag from "../components/CCStatusTag.vue";
import {
  getDashboardOverview,
  type DashboardOverview,
  type SchedulerJobStatus,
} from "../api/dashboard";
import { getDownloaderStatus, type DownloaderStatus } from "../api/downloaders";

const overview = ref<DashboardOverview>();
const loading = ref(false);
const error = ref("");
const lastUpdatedAt = ref("");
const statusById = ref<Record<string, DownloaderStatus | undefined>>({});
const hasLiveSpeedById = ref<Record<string, boolean>>({});
let statusTimer: number | undefined;
let statusRefreshInFlight = false;

const currentHour = new Date().getHours();
const greeting =
  currentHour < 6
    ? "夜深了"
    : currentHour < 12
      ? "早上好"
      : currentHour < 18
        ? "下午好"
        : "晚上好";
const siteAttentionCount = computed(
  () =>
    (overview.value?.sites.authFailed ?? 0) +
    (overview.value?.sites.offline ?? 0),
);
const taskAttentionCount = computed(() => overview.value?.tasks.failed ?? 0);
const downloaderAttentionCount = computed(
  () =>
    overview.value?.downloaders.items.filter((item) => {
      const status = displayStatus(item);
      return status === "OFFLINE" || status === "AUTH_FAILED";
    }).length ?? 0,
);
const attentionCount = computed(
  () =>
    siteAttentionCount.value +
    downloaderAttentionCount.value +
    taskAttentionCount.value,
);
const statusHeadline = computed(() =>
  attentionCount.value > 0
    ? `有 ${attentionCount.value} 项需要关注`
    : "系统运行稳定",
);
const attentionTitle = computed(() =>
  attentionCount.value > 0 ? "需要处理运行异常" : "未发现运行异常",
);
const attentionDescription = computed(() => {
  if (!attentionCount.value) return "站点连接和自动化任务状态正常。";
  const parts = [];
  if (siteAttentionCount.value)
    parts.push(`${siteAttentionCount.value} 个站点异常`);
  if (downloaderAttentionCount.value)
    parts.push(`${downloaderAttentionCount.value} 个下载器异常`);
  if (taskAttentionCount.value)
    parts.push(`${taskAttentionCount.value} 个任务失败`);
  return parts.join("，");
});
const attentionTarget = computed(() =>
  siteAttentionCount.value > 0
    ? "/sites"
    : downloaderAttentionCount.value > 0
      ? "/downloaders"
    : taskAttentionCount.value > 0
      ? "/tasks"
      : "/dashboard",
);
const onlineDownloaderCount = computed(
  () =>
    overview.value?.downloaders.items.filter(
      (item) => displayStatus(item) === "ONLINE",
    ).length ?? 0,
);
const liveDownloaderStatuses = computed(() =>
  Object.entries(statusById.value)
    .filter(
      ([id, status]) => hasLiveSpeedById.value[id] && status?.status === "ONLINE",
    )
    .map(([, status]) => status as DownloaderStatus),
);
const totalUploadSpeed = computed(() =>
  liveDownloaderStatuses.value.length
    ? liveDownloaderStatuses.value.reduce(
        (sum, status) => sum + status.uploadSpeed,
        0,
      )
    : undefined,
);
const totalDownloadSpeed = computed(() =>
  liveDownloaderStatuses.value.length
    ? liveDownloaderStatuses.value.reduce(
        (sum, status) => sum + status.downloadSpeed,
        0,
      )
    : undefined,
);

function formatBytes(value?: number, suffix = "") {
  if (value === undefined || value === null) return "--";
  if (value <= 0) return `0 B${suffix}`;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}${suffix}`;
}

function downloaderTypeText(
  type: DashboardOverview["downloaders"]["items"][number]["type"],
) {
  return type === "QBITTORRENT" ? "qBittorrent" : type;
}

function downloaderStatusMeta(
  status: DashboardOverview["downloaders"]["items"][number]["status"],
) {
  const map = {
    ONLINE: { label: "在线", className: "online-chip" },
    OFFLINE: { label: "离线", className: "offline-chip" },
    AUTH_FAILED: { label: "认证失败", className: "auth-chip" },
    UNKNOWN: { label: "未检测", className: "unknown-chip" },
  };
  return map[status];
}

function downloaderTone(
  status: DashboardOverview["downloaders"]["items"][number]["status"],
) {
  if (status === "ONLINE") return "success" as const;
  if (status === "AUTH_FAILED") return "warning" as const;
  if (status === "OFFLINE") return "danger" as const;
  return "neutral" as const;
}

function displayStatus(
  downloader: DashboardOverview["downloaders"]["items"][number],
) {
  return statusById.value[downloader.id]?.status ?? downloader.status;
}

function displaySpeed(id: string, direction: "upload" | "download") {
  if (!hasLiveSpeedById.value[id]) return undefined;
  const status = statusById.value[id];
  return direction === "upload" ? status?.uploadSpeed : status?.downloadSpeed;
}

function jobStatusText(
  status: DashboardOverview["tasks"]["recent"][number]["status"],
) {
  const map = {
    SUCCESS: "成功",
    FAILED: "失败",
    RUNNING: "运行中",
  };
  return map[status];
}

function jobTone(
  status: DashboardOverview["tasks"]["recent"][number]["status"],
) {
  if (status === "SUCCESS") return "success" as const;
  if (status === "FAILED") return "danger" as const;
  return "running" as const;
}

function schedulerStatusClass(job: SchedulerJobStatus) {
  if (job.running) return "running";
  if (job.lastStatus === "FAILED") return "failed";
  if (job.lastStatus === "SUCCESS") return "success";
  return "";
}

function schedulerStatusText(job: SchedulerJobStatus) {
  if (job.running) return "运行中";
  if (job.lastStatus === "FAILED") return "失败";
  if (job.lastStatus === "SUCCESS") return "空闲";
  return "等待中";
}

function schedulerTone(job: SchedulerJobStatus) {
  if (job.running) return "running" as const;
  if (job.lastStatus === "FAILED") return "danger" as const;
  if (job.lastStatus === "SUCCESS") return "success" as const;
  return "neutral" as const;
}

function formatInterval(ms: number) {
  if (ms >= 86400000) return `${Math.floor(ms / 86400000)} 天`;
  if (ms >= 3600000) return `${Math.floor(ms / 3600000)} 小时`;
  if (ms >= 60000) return `${Math.floor(ms / 60000)} 分钟`;
  return `${Math.floor(ms / 1000)} 秒`;
}

function formatTime(value?: string) {
  if (!value) return "-";
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? "后" : "前";

  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  const seconds = Math.floor((abs % 60000) / 1000);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}秒`);

  return parts.join("") + sign;
}

async function loadOverview() {
  loading.value = true;
  error.value = "";
  try {
    overview.value = await getDashboardOverview();
    lastUpdatedAt.value = new Date().toLocaleString("zh-CN");
    void refreshAllStatuses();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "首页数据加载失败";
  } finally {
    loading.value = false;
  }
}

async function refreshDownloaderStatus(
  downloader: DashboardOverview["downloaders"]["items"][number],
) {
  if (document.hidden) return;
  try {
    const status = await getDownloaderStatus(downloader.id, true);
    const previous = statusById.value[downloader.id];
    const hasLiveSpeed = status.status === "ONLINE";
    statusById.value = {
      ...statusById.value,
      [downloader.id]: hasLiveSpeed
        ? status
        : {
            ...status,
            uploadSpeed: previous?.uploadSpeed ?? status.uploadSpeed,
            downloadSpeed: previous?.downloadSpeed ?? status.downloadSpeed,
          },
    };
    if (hasLiveSpeed) {
      hasLiveSpeedById.value = {
        ...hasLiveSpeedById.value,
        [downloader.id]: true,
      };
    }
  } catch {
    // skipWrite 轮询静默忽略错误
  }
}

async function refreshAllStatuses() {
  if (
    document.hidden ||
    statusRefreshInFlight ||
    !overview.value?.downloaders.items.length
  )
    return;
  statusRefreshInFlight = true;
  try {
    await Promise.allSettled(
      overview.value.downloaders.items.map(refreshDownloaderStatus),
    );
  } finally {
    statusRefreshInFlight = false;
  }
}

function stopStatusPolling() {
  if (statusTimer !== undefined) window.clearInterval(statusTimer);
  statusTimer = undefined;
}

function startStatusPolling() {
  stopStatusPolling();
  if (!overview.value?.downloaders.items.length) return;
  statusTimer = window.setInterval(refreshAllStatuses, 1000);
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopStatusPolling();
  } else {
    refreshAllStatuses();
    startStatusPolling();
  }
}

onMounted(async () => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
  await loadOverview();
  startStatusPolling();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  stopStatusPolling();
});
</script>
