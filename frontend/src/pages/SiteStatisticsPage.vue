<template>
  <AppLayout>
    <section class="feature-page statistics-page">
      <CCPageHeader
        eyebrow="数据分析"
        title="流量"
        description="按来源站点和日期统计 qBittorrent 种子的实际上传、下载增量。"
      />

      <section class="site-stats statistics-summary">
        <article class="metric-card">
          <span>总上传</span
          ><strong class="success">{{
            formatBytes(result.allTimeUploaded)
          }}</strong>
        </article>
        <article class="metric-card">
          <span>总下载</span
          ><strong>{{ formatBytes(result.allTimeDownloaded) }}</strong>
        </article>
        <article class="metric-card">
          <span>总站点数</span><strong>{{ result.allTimeSiteCount }}</strong>
        </article>
      </section>

      <section class="sites-toolbar statistics-toolbar cc-toolbar cc-card">
        <div class="statistics-date-cell">
          <span class="statistics-date-label">开始日期</span>
          <StatisticsDatePicker
            v-model="filters.startDate"
            :max="todayKey"
            title="选择开始日期"
            placeholder="选择开始日期"
            @change="onStartChange"
          />
        </div>
        <div class="statistics-date-cell">
          <span class="statistics-date-label">结束日期</span>
          <StatisticsDatePicker
            v-model="filters.endDate"
            :min="filters.startDate"
            :max="todayKey"
            title="选择结束日期"
            placeholder="选择结束日期"
            @change="onEndChange"
          />
        </div>
      </section>

      <section class="statistics-presets">
        <span class="statistics-presets-label">快捷</span>
        <button
          v-for="preset in presets"
          :key="preset.key"
          type="button"
          class="statistics-preset-chip"
          :class="{ active: isPresetActive(preset) }"
          @click="applyPreset(preset)"
        >
          {{ preset.label }}
        </button>
      </section>

      <section class="cc-card cc-list-surface statistics-chart-panel">
        <div class="panel-title-row">
          <h2>流量趋势</h2>
        </div>
        <div v-if="error" class="error-banner">
          {{ error }}<button type="button" @click="loadStatistics">重试</button>
        </div>
        <div class="statistics-pie-grid">
          <div class="statistics-pie-card">
            <div class="statistics-pie-card-title">
              上传 共 <strong>{{ formatBytes(result.totalUploaded) }}</strong>
            </div>
            <StatisticsPieChart
              :slices="uploadSlices"
              empty-text="暂无上传数据"
            />
          </div>
          <div class="statistics-pie-card">
            <div class="statistics-pie-card-title">
              下载 共 <strong>{{ formatBytes(result.totalDownloaded) }}</strong>
            </div>
            <StatisticsPieChart
              :slices="downloadSlices"
              empty-text="暂无下载数据"
            />
          </div>
        </div>
      </section>

      <section class="cc-card cc-list-surface statistics-list-panel">
        <div class="panel-title-row">
          <h2>站点流量</h2>
          <span>共 {{ result.total }} 个站点</span>
        </div>
        <CCStateView
          v-if="!result.items.length && !loading"
          title="当前区间暂无流量"
          description="种子同步产生上传或下载增量后，会在这里按日期累计。"
        />
        <div v-else class="statistics-site-list">
          <div class="statistics-site-head">
            <span>站点</span><span>上传</span><span>下载</span>
          </div>
          <div
            v-for="site in result.items"
            :key="site.siteId"
            class="statistics-site-card"
          >
            <div class="statistics-site-name">
              <strong>{{ site.siteName }}</strong>
              <span v-if="site.siteDeleted" class="chip muted-chip"
                >站点已删除</span
              >
            </div>
            <div class="statistics-site-stat">
              <small>上传</small
              ><strong class="success"
                >{{ formatBytes(site.uploaded)
                }}<span class="statistics-site-divider">|</span
                ><span class="statistics-site-share">{{
                  formatShare(site.uploaded, result.totalUploaded)
                }}</span></strong
              >
            </div>
            <div class="statistics-site-stat">
              <small>下载</small
              ><strong
                >{{ formatBytes(site.downloaded)
                }}<span class="statistics-site-divider">|</span
                ><span class="statistics-site-share">{{
                  formatShare(site.downloaded, result.totalDownloaded)
                }}</span></strong
              >
            </div>
            <div class="statistics-daily-table">
              <div class="statistics-daily-row statistics-daily-head">
                <span>日期</span><span>上传增量</span><span>下载增量</span>
              </div>
              <div
                v-for="day in site.daily"
                :key="day.date"
                class="statistics-daily-row"
              >
                <span>{{ day.date }}</span
                ><span>{{ formatBytes(day.uploaded) }}</span
                ><span>{{ formatBytes(day.downloaded) }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="result.total > filters.pageSize" class="pagination">
          <button
            type="button"
            :disabled="filters.page <= 1 || loading"
            @click="changePage(filters.page - 1)"
          >
            上一页
          </button>
          <span>第 {{ filters.page }} / {{ totalPages }} 页</span>
          <button
            type="button"
            :disabled="filters.page >= totalPages || loading"
            @click="changePage(filters.page + 1)"
          >
            下一页
          </button>
        </div>
      </section>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import AppLayout from "../components/AppLayout.vue";
import CCPageHeader from "../components/CCPageHeader.vue";
import CCStateView from "../components/CCStateView.vue";
import StatisticsPieChart, {
  type PieSlice,
} from "../components/StatisticsPieChart.vue";
import StatisticsDatePicker from "../components/StatisticsDatePicker.vue";
import {
  getSiteStatistics,
  type SiteStatisticsResponse,
} from "../api/siteStatistics";
import { Snackbar } from "@varlet/ui";

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayKey() {
  return dateKey(new Date());
}

const todayKey = ref(getTodayKey());
const filters = reactive({
  startDate: todayKey.value,
  endDate: todayKey.value,
  siteId: "",
  page: 1,
  pageSize: 20,
});

type Preset = { key: string; label: string; offset: number; span: number };

const presets: Preset[] = [
  { key: "today", label: "今天", offset: 0, span: 1 },
  { key: "yesterday", label: "昨天", offset: 1, span: 1 },
  { key: "7d", label: "最近 7 天", offset: 0, span: 7 },
  { key: "30d", label: "最近 30 天", offset: 0, span: 30 },
];

function computePresetRange(preset: Preset) {
  const end = new Date();
  end.setDate(end.getDate() - preset.offset);
  const start = new Date(end);
  start.setDate(end.getDate() - (preset.span - 1));
  return { startKey: dateKey(start), endKey: dateKey(end) };
}

function applyPreset(preset: Preset) {
  todayKey.value = getTodayKey();
  const { startKey, endKey } = computePresetRange(preset);
  filters.startDate = startKey;
  filters.endDate = endKey;
  autoSearch();
}

function isPresetActive(preset: Preset) {
  const { startKey, endKey } = computePresetRange(preset);
  return filters.startDate === startKey && filters.endDate === endKey;
}

function onStartChange(value: string) {
  if (filters.endDate && value > filters.endDate) {
    filters.endDate = value;
  }
  autoSearch();
}

function onEndChange(value: string) {
  if (filters.startDate && value < filters.startDate) {
    Snackbar.warning("结束日期不能早于开始日期");
    return;
  }
  autoSearch();
}
const result = reactive<SiteStatisticsResponse>({
  startDate: filters.startDate,
  endDate: filters.endDate,
  totalUploaded: 0,
  totalDownloaded: 0,
  siteCount: 0,
  allTimeUploaded: 0,
  allTimeDownloaded: 0,
  allTimeSiteCount: 0,
  total: 0,
  page: 1,
  pageSize: 20,
  siteOptions: [],
  items: [],
});
const loading = ref(false);
const error = ref("");
const totalPages = computed(() =>
  Math.max(Math.ceil(result.total / filters.pageSize), 1),
);

async function loadStatistics() {
  loading.value = true;
  error.value = "";
  try {
    const data = await getSiteStatistics({
      startDate: filters.startDate,
      endDate: filters.endDate,
      siteId: filters.siteId || undefined,
      page: filters.page,
      pageSize: filters.pageSize,
    });
    Object.assign(result, data);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "流量加载失败";
  } finally {
    loading.value = false;
  }
}

function autoSearch() {
  filters.page = 1;
  void loadStatistics();
}

function changePage(page: number) {
  filters.page = page;
  void loadStatistics();
}

function formatBytes(value = 0) {
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
}

function formatShare(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

const PIE_PALETTE = [
  "#3f7cff",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f43f5e",
  "#a3a3a3",
];
const MAX_PIE_SLICES = 8;

function buildPieSlices(key: "uploaded" | "downloaded"): PieSlice[] {
  const colorBySite = new Map<string, string>();
  result.siteOptions.forEach((opt, i) => {
    colorBySite.set(opt.siteId, PIE_PALETTE[i % PIE_PALETTE.length]);
  });
  const total = result.items.reduce((sum, it) => sum + it[key], 0);
  if (total <= 0) return [];
  const sorted = [...result.items].sort((a, b) => b[key] - a[key]);
  const top = sorted.slice(0, MAX_PIE_SLICES);
  const rest = sorted.slice(MAX_PIE_SLICES);
  const restSum = rest.reduce((sum, it) => sum + it[key], 0);
  const slices: PieSlice[] = top.map((it) => ({
    name: it.siteName,
    value: it[key],
    color: colorBySite.get(it.siteId) ?? PIE_PALETTE[0],
    percent: (it[key] / total) * 100,
  }));
  if (restSum > 0) {
    slices.push({
      name: `其他（${rest.length}）`,
      value: restSum,
      color: PIE_PALETTE[PIE_PALETTE.length - 1],
      percent: (restSum / total) * 100,
    });
  }
  return slices;
}

const uploadSlices = computed(() => buildPieSlices("uploaded"));
const downloadSlices = computed(() => buildPieSlices("downloaded"));

onMounted(loadStatistics);
</script>
