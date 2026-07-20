<template>
  <AppLayout>
    <section class="feature-page site-history-page">
      <CCPageHeader
        eyebrow="站点管理 / 每日数据"
        :title="result.site?.displayName || '站点每日数据'"
        :description="result.site.id ? `${result.site.domain} · 每天最后一次成功更新的数据` : '查看站点每日累计数据与变化。'"
      >
        <template #actions>
          <router-link class="secondary-button outline" to="/sites">返回站点列表</router-link>
        </template>
      </CCPageHeader>

      <section class="sites-toolbar statistics-toolbar cc-toolbar cc-card history-toolbar">
        <div class="statistics-date-cell">
          <span class="statistics-date-label">开始日期</span>
          <StatisticsDatePicker
            v-model="filters.startDate"
            :max="todayKey"
            title="选择开始日期"
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
            @change="onEndChange"
          />
        </div>
      </section>

      <section class="statistics-presets">
        <span class="statistics-presets-label">快捷</span>
        <button
          v-for="preset in presets"
          :key="preset.days"
          type="button"
          class="statistics-preset-chip"
          :class="{ active: isPresetActive(preset.days) }"
          @click="applyPreset(preset.days)"
        >
          {{ preset.label }}
        </button>
      </section>

      <section class="cc-card cc-list-surface history-list-panel">
        <div class="panel-title-row">
          <h2>每日记录</h2>
          <span>共 {{ result.total }} 天</span>
        </div>

        <div v-if="error" class="error-banner">
          {{ error }}<button type="button" @click="loadHistory">重试</button>
        </div>
        <CCStateView
          v-if="loading && !result.items.length"
          tone="loading"
          title="正在加载每日数据"
        />
        <CCStateView
          v-else-if="!result.items.length && !error"
          title="当前区间暂无每日数据"
          description="站点信息成功更新后，会按天保存到这里。"
        />

        <div v-else class="history-desktop-table">
          <div class="history-row history-head">
            <span>日期</span><span>累计上传</span><span>上传变化</span><span>累计下载</span><span>下载变化</span><span>分享率</span><span>等级</span><span>最后同步</span>
          </div>
          <div v-for="item in result.items" :key="item.id" class="history-row">
            <strong>{{ item.date }}</strong>
            <span>{{ formatBytes(item.uploaded) }}</span>
            <span :class="deltaClass(item.uploadedDelta)">{{ formatDelta(item.uploadedDelta) }}</span>
            <span>{{ formatBytes(item.downloaded) }}</span>
            <span :class="deltaClass(item.downloadedDelta)">{{ formatDelta(item.downloadedDelta) }}</span>
            <span>{{ formatRatio(item) }}</span>
            <span>{{ item.userLevel || '-' }}</span>
            <span>{{ formatSyncedAt(item.syncedAt) }}</span>
          </div>
        </div>

        <div class="history-mobile-list">
          <article v-for="item in result.items" :key="item.id" class="cc-card history-mobile-card">
            <div><strong>{{ item.date }}</strong><span>{{ formatSyncedAt(item.syncedAt) }}</span></div>
            <dl>
              <div><dt>累计上传</dt><dd>{{ formatBytes(item.uploaded) }}</dd><small :class="deltaClass(item.uploadedDelta)">{{ formatDelta(item.uploadedDelta) }}</small></div>
              <div><dt>累计下载</dt><dd>{{ formatBytes(item.downloaded) }}</dd><small :class="deltaClass(item.downloadedDelta)">{{ formatDelta(item.downloadedDelta) }}</small></div>
              <div><dt>分享率</dt><dd>{{ formatRatio(item) }}</dd></div>
              <div><dt>等级</dt><dd>{{ item.userLevel || '-' }}</dd></div>
            </dl>
          </article>
        </div>

        <div v-if="result.total > filters.pageSize" class="pagination">
          <button type="button" :disabled="filters.page <= 1 || loading" @click="changePage(filters.page - 1)">上一页</button>
          <span>第 {{ filters.page }} / {{ totalPages }} 页</span>
          <button type="button" :disabled="filters.page >= totalPages || loading" @click="changePage(filters.page + 1)">下一页</button>
        </div>
      </section>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import { Snackbar } from "@varlet/ui";
import AppLayout from "../components/AppLayout.vue";
import CCPageHeader from "../components/CCPageHeader.vue";
import CCStateView from "../components/CCStateView.vue";
import StatisticsDatePicker from "../components/StatisticsDatePicker.vue";
import { getSiteDailyHistory, type SiteDailyHistoryItem, type SiteDailyHistoryResponse } from "../api/sites";

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeForDays(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: dateKey(start), endDate: dateKey(end) };
}

const route = useRoute();
const siteId = computed(() => String(route.params.id));
const todayKey = dateKey(new Date());
const initialRange = rangeForDays(30);
const filters = reactive({ ...initialRange, page: 1, pageSize: 30 });
const presets = [
  { label: "最近 30 天", days: 30 },
  { label: "最近 90 天", days: 90 },
  { label: "最近 1 年", days: 365 },
];
const result = reactive<SiteDailyHistoryResponse>({
  site: { id: "", displayName: "", domain: "" },
  startDate: filters.startDate,
  endDate: filters.endDate,
  items: [],
  total: 0,
  page: 1,
  pageSize: filters.pageSize,
});
const loading = ref(false);
const error = ref("");
const totalPages = computed(() => Math.max(Math.ceil(result.total / filters.pageSize), 1));

async function loadHistory() {
  loading.value = true;
  error.value = "";
  try {
    Object.assign(result, await getSiteDailyHistory(siteId.value, filters));
  } catch (err) {
    error.value = err instanceof Error ? err.message : "每日数据加载失败";
  } finally {
    loading.value = false;
  }
}

function searchFromFirstPage() {
  filters.page = 1;
  void loadHistory();
}

function onStartChange(value: string) {
  if (value > filters.endDate) filters.endDate = value;
  searchFromFirstPage();
}

function onEndChange(value: string) {
  if (value < filters.startDate) {
    Snackbar.warning("结束日期不能早于开始日期");
    return;
  }
  searchFromFirstPage();
}

function applyPreset(days: number) {
  Object.assign(filters, rangeForDays(days));
  searchFromFirstPage();
}

function isPresetActive(days: number) {
  const range = rangeForDays(days);
  return filters.startDate === range.startDate && filters.endDate === range.endDate;
}

function changePage(page: number) {
  filters.page = Math.min(Math.max(page, 1), totalPages.value);
  void loadHistory();
}

function formatBytes(value?: number) {
  if (value === undefined) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 2 ? 2 : 1)} ${units[index]}`;
}

function formatDelta(value?: number) {
  if (value === undefined) return "-";
  if (value === 0) return "±0 B";
  return `${value > 0 ? "+" : "-"}${formatBytes(Math.abs(value))}`;
}

function deltaClass(value?: number) {
  return value === undefined || value === 0 ? "history-delta" : value > 0 ? "history-delta is-positive" : "history-delta is-negative";
}

function formatRatio(item: SiteDailyHistoryItem) {
  if (item.ratioInfinite) return "∞";
  return item.ratio === undefined ? "-" : item.ratio.toFixed(2);
}

function formatSyncedAt(value: string) {
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

onMounted(loadHistory);
</script>

<style scoped>
.site-history-page { display: grid; gap: 18px; }
.history-toolbar { grid-template-columns: repeat(2, minmax(220px, 320px)); }
.history-list-panel { overflow-x: auto; }
.history-desktop-table { min-width: 1080px; }
.history-row { display: grid; grid-template-columns: 120px 1.1fr 1fr 1.1fr 1fr .7fr 1fr 1.1fr; gap: 14px; align-items: center; min-height: 62px; padding: 0 20px; border-top: 1px solid #edf1f7; font-size: 14px; }
.history-head { min-height: 46px; border-top: 0; background: #f8fafc; color: #64748b; font-size: 12px; font-weight: 700; }
.history-delta { color: #64748b; font-weight: 700; }
.history-delta.is-positive { color: #059669; }
.history-delta.is-negative { color: #dc2626; }
.history-mobile-list { display: none; }
@media (max-width: 767px) {
  .history-toolbar { grid-template-columns: 1fr; }
  .history-desktop-table { display: none; }
  .history-mobile-list { display: grid; gap: 12px; padding: 12px; }
  .history-mobile-card { padding: 16px; }
  .history-mobile-card > div { display: flex; justify-content: space-between; gap: 12px; color: #64748b; }
  .history-mobile-card > div strong { color: #0f172a; }
  .history-mobile-card dl { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 12px; margin: 16px 0 0; }
  .history-mobile-card dl div { min-width: 0; }
  .history-mobile-card dt { color: #64748b; font-size: 12px; }
  .history-mobile-card dd { margin: 5px 0 0; color: #0f172a; font-weight: 700; }
  .history-mobile-card small { display: block; margin-top: 3px; }
}
</style>
