<template>
  <AppLayout>
    <section class="feature-page">
      <CCPageHeader
        eyebrow="任务管理"
        title="自动化任务"
        description="自动执行开关、运行和测试保持高频可见，配置与危险操作统一收纳。"
      />

      <section class="sites-toolbar tasks-toolbar cc-toolbar cc-card">
        <input
          v-model.trim="filters.keyword"
          placeholder="搜索任务 / 站点 / 下载器"
          @keyup.enter="loadTasks"
        />
        <select
          v-if="isDesktop"
          v-model="filters.autoRun"
          @change="loadTasks"
          aria-label="按自动执行状态过滤"
        >
          <option value="ALL">自动执行：全部</option>
          <option value="ON">已开启</option>
          <option value="OFF">已关闭</option>
        </select>
        <SegmentedButtons
          v-else
          class="toolbar-filter-segmented"
          v-model="filters.autoRun"
          :options="autoRunFilterOptions"
          size="small"
          @change="loadTasks"
        />
        <button
          class="secondary-button toolbar-refresh-action"
          type="button"
          :disabled="loading"
          @click="loadTasks"
        >
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button
          class="secondary-button outline filter-secondary-action"
          type="button"
          :disabled="loading"
          @click="handleExport"
        >
          导出
        </button>
        <button
          class="secondary-button outline filter-secondary-action"
          type="button"
          :disabled="loading"
          @click="triggerImport"
        >
          导入
        </button>
        <button
          class="primary-button compact toolbar-primary-action"
          type="button"
          @click="openCreate"
        >
          新建任务
        </button>
        <input
          ref="importInputRef"
          type="file"
          accept=".json"
          hidden
          @change="handleImport"
        />
      </section>

      <section class="cc-card cc-list-surface">
        <div class="panel-title-row">
          <h2>任务列表</h2>
          <span>{{ total }} 个任务</span>
        </div>
        <div v-if="error" class="error-banner">
          {{ error }}<button type="button" @click="loadTasks">重试</button>
        </div>
        <CCStateView
          v-if="!items.length && !loading"
          title="还没有任务"
          description="先配置站点和下载器，然后创建第一个抓取推送任务。"
        >
          <button
            class="primary-button compact"
            type="button"
            @click="openCreate"
          >
            新建任务
          </button>
        </CCStateView>
        <div v-else class="desktop-table task-table task-command-list">
          <article
            v-for="task in items"
            :key="task.id"
            class="task-row task-command-card"
          >
            <div class="task-command-main">
              <div class="task-command-title">
                <strong>{{ task.name }}</strong
                ><span class="chip" :class="statusClass(task)">{{
                  statusText(task)
                }}</span>
              </div>
              <p>
                {{ task.siteName }} · {{ task.downloaderName }} ·
                {{ rangeText(task) }}
              </p>
              <div class="task-command-schedule">
                <span>自动执行</span>
                <button
                  class="switch"
                  :class="{ on: task.autoRunEnabled }"
                  type="button"
                  :disabled="task.running"
                  @click="toggleAutoRun(task)"
                >
                  <span></span>
                </button>
                <span>每 {{ task.intervalMinutes }} 分钟</span><i>·</i
                ><span>下次 {{ formatDate(task.nextRunAt) }}</span
                ><i>·</i><span>最近：{{ task.lastSummary || "-" }}</span>
              </div>
            </div>
            <div class="row-actions compact-actions task-command-actions">
              <button
                type="button"
                :disabled="task.running || testingTaskId === task.id"
                @click="testExistingTask(task)"
              >
                {{ testingTaskId === task.id ? "测试中..." : "测试" }}
              </button>
              <button
                class="row-primary-action"
                type="button"
                :disabled="task.running"
                @click="runExistingTask(task)"
              >
                {{ task.running ? "运行中..." : "运行" }}
              </button>
              <AppActionMenu
                :items="taskMenuItems(task)"
                :label="`${task.name} 的更多操作`"
                @select="handleTaskMenu(task, $event)"
              />
            </div>
          </article>
        </div>

        <div class="mobile-task-list">
          <article
            v-for="task in items"
            :key="task.id"
            class="cc-card cc-mobile-card task-card"
          >
            <div>
              <strong>{{ task.name }}</strong>
              <span class="chip" :class="statusClass(task)">{{
                statusText(task)
              }}</span>
            </div>
            <p>{{ task.siteName }} · {{ task.downloaderName }}</p>
            <p class="cc-mobile-summary">
              每 {{ task.intervalMinutes }} 分钟 · {{ rangeText(task) }}
            </p>
            <p :class="task.autoRunEnabled ? 'success' : ''">
              自动执行{{ task.autoRunEnabled ? "开启" : "关闭" }} · 下次
              {{ formatDate(task.nextRunAt) }}
            </p>
            <p class="cc-mobile-summary">最近：{{ task.lastSummary || "-" }}</p>
            <div class="mobile-task-toggle">
              <span>自动执行</span>
              <button
                class="switch"
                :class="{ on: task.autoRunEnabled }"
                type="button"
                :disabled="task.running"
                @click="toggleAutoRun(task)"
              >
                <span></span>
              </button>
            </div>
            <div class="row-actions compact-actions">
              <button
                type="button"
                :disabled="task.running || testingTaskId === task.id"
                @click="testExistingTask(task)"
              >
                {{ testingTaskId === task.id ? "测试中..." : "测试" }}
              </button>
              <button
                class="row-primary-action"
                type="button"
                :disabled="task.running"
                @click="runExistingTask(task)"
              >
                {{ task.running ? "运行中..." : "运行" }}
              </button>
              <AppActionMenu
                :items="taskMenuItems(task)"
                :label="`${task.name} 的更多操作`"
                @select="handleTaskMenu(task, $event)"
              />
            </div>
          </article>
        </div>
      </section>
    </section>

    <div v-if="formVisible" class="cc-modal-backdrop modal-backdrop">
      <form
        class="cc-form-dialog site-form task-form"
        @submit.prevent="saveTask"
      >
        <div class="cc-form-head form-head">
          <div>
            <h2>{{ editingTaskId ? "编辑任务" : "新建任务" }}</h2>
            <p>测试不会记录，运行会写入种子和任务日志。</p>
          </div>
          <button type="button" @click="formVisible = false">×</button>
        </div>
        <div class="task-form-sections">
          <section class="form-section">
            <h3>基础配置</h3>
            <div class="form-grid two-col">
              <label
                >任务名称<input
                  v-model.trim="form.name"
                  placeholder="例如 MTeam 免费自动推送"
              /></label>
              <label
                >执行间隔（分钟）<input
                  v-model.number="form.intervalMinutes"
                  min="10"
                  type="number"
              /></label>
              <label
                >站点
                <AppSelect
                  v-model="form.siteId"
                  placeholder="请选择站点"
                  :options="siteOptions"
                  :rules="[(v) => !!v || '请选择站点']"
                />
              </label>
              <label
                >下载器
                <AppSelect
                  v-model="form.downloaderId"
                  placeholder="请选择下载器"
                  :options="downloaderOptions"
                  :rules="[(v) => !!v || '请选择下载器']"
                />
              </label>
            </div>
            <div class="check-grid">
              <label class="inline-check"
                ><input v-model="form.autoRunEnabled" type="checkbox" />
                启用自动执行</label
              >
              <label class="inline-check"
                ><input v-model="form.autoPush" type="checkbox" />
                自动推送到下载器</label
              >
            </div>
            <label
              >默认保存路径<input
                v-model.trim="form.savePathOverride"
                placeholder="不填则使用下载器 QB/TR 默认路径"
            /></label>
          </section>

          <section class="form-section">
            <h3>抓取规则</h3>
            <div class="form-grid two-col">
              <label
                >抓取数量
                <input
                  v-model.number="form.fetchLimit"
                  min="1"
                  max="1000"
                  step="1"
                  type="number"
                  placeholder="默认 100"
                />
              </label>
              <label class="full"
                >排序规则
                <AppSelect
                  v-model="form.sortRule"
                  placeholder="不排序（按抓取顺序）"
                  :options="sortRuleSelectOptions"
                  clearable
                />
              </label>
              <label
                >入库数量
                <input
                  v-model.number="form.torrentCount"
                  min="0"
                  step="1"
                  type="number"
                  placeholder="0 表示不限制"
                />
              </label>
            </div>
            <fieldset class="rule-group">
              <legend>HR 策略</legend>
              <label class="inline-check">
                <input v-model="form.skipHitAndRun" type="checkbox" /> 跳过 HR
                种子（H3/H5/未完成 HR，默认勾选）
              </label>
            </fieldset>
            <fieldset class="rule-group">
              <legend>优惠类型（任选其一命中即可）</legend>
              <div class="check-grid">
                <label
                  v-for="type in discountOptions"
                  :key="type.value"
                  class="inline-check"
                >
                  <input
                    v-model="form.discountTypes"
                    type="checkbox"
                    :value="type.value"
                  />
                  {{ type.label }}
                </label>
              </div>
            </fieldset>
            <fieldset class="rule-group">
              <legend>种子体积（GB，0 表示不限制）</legend>
              <div class="form-grid two-col">
                <label
                  >最小体积<input
                    v-model.number="form.sizeMinGb"
                    min="0"
                    step="1"
                    type="number"
                /></label>
                <label
                  >最大体积<input
                    v-model.number="form.sizeMaxGb"
                    min="0"
                    step="1"
                    type="number"
                /></label>
              </div>
            </fieldset>
            <fieldset class="rule-group">
              <legend>做种人数（0 表示不限制）</legend>
              <div class="form-grid two-col">
                <label
                  >最小做种人数<input
                    v-model.number="form.seederMin"
                    min="0"
                    step="1"
                    type="number"
                /></label>
                <label
                  >最大做种人数<input
                    v-model.number="form.seederMax"
                    min="0"
                    step="1"
                    type="number"
                /></label>
              </div>
            </fieldset>
          </section>

          <section class="form-section">
            <h3>
              删除规则
              <button
                class="hint-button"
                type="button"
                aria-label="删除条件说明"
                @click="showOnlyFreeDownloadHint = !showOnlyFreeDownloadHint"
              >
                ?
              </button>
            </h3>
            <p v-if="showOnlyFreeDownloadHint" class="inline-hint">
              满足任一条件就会自动删除该种子在下载器中的任务并删除已下载的文件。
            </p>
            <fieldset class="rule-group">
              <legend>下载器删除条件（任一命中即删除任务+文件）</legend>
              <label class="inline-check"
                ><input v-model="form.onlyFreeDownload" type="checkbox" />
                仅免费下载（已过免费期且未下载完成）</label
              >
              <label class="inline-check"
                ><input v-model="form.deleteOnFreeExpire" type="checkbox" />
                免费到期（无视下载进度）</label
              >
              <div class="inline-row">
                <span>上传速度低于</span>
                <input
                  v-model.number="form.lowUploadKbps"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0 表示不启用"
                />
                <span>KB/秒，持续</span>
                <input
                  v-model.number="form.lowUploadMinutes"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0 表示不启用"
                />
                <span>分钟</span>
              </div>
            </fieldset>
          </section>
        </div>
        <div class="cc-form-foot form-foot">
          <span>开启自动执行后，从保存时间开始计时。</span>
          <div class="row-actions">
            <button
              type="button"
              class="secondary-button outline"
              @click="formVisible = false"
            >
              取消
            </button>
            <button
              type="submit"
              class="primary-button compact"
              :disabled="saving"
            >
              {{ saving ? "保存中..." : "保存" }}
            </button>
          </div>
        </div>
      </form>
    </div>

    <div v-if="testResult" class="cc-modal-backdrop modal-backdrop">
      <section class="cc-form-dialog site-form test-result-dialog">
        <div class="cc-form-head form-head">
          <div>
            <h2>测试结果</h2>
            <p class="test-summary-title">
              {{ testResult.taskName }} · {{ testResult.siteName }}
            </p>
            <p class="test-summary-stats">
              <span class="stat">抓取 {{ testResult.fetchedCount }} 个</span>
              <span
                v-if="(testResult.skippedExistingCount ?? 0) > 0"
                class="stat"
                >去重 {{ testResult.skippedExistingCount }} 个</span
              >
              <span class="stat">命中 {{ testResult.matchedCount }} 个</span>
              <span
                v-if="(testResult.excludedByHitAndRunCount ?? 0) > 0"
                class="stat"
                >HR 跳过 {{ testResult.excludedByHitAndRunCount }} 个</span
              >
              <span class="stat stat-pushable"
                >待入库 {{ testResult.pushableCount }} 个</span
              >
            </p>
          </div>
          <button type="button" @click="testResult = undefined">×</button>
        </div>
        <div class="test-result-list">
          <article
            v-for="item in testResult.items"
            :key="item.torrentId"
            :class="{
              'is-matched': item.matched,
              'is-pushable': item.pushable,
              'is-skipped': item.skippedExisting,
              'is-excluded': item.excludedBy,
            }"
          >
            <strong>
              <span
                v-if="item.skippedExisting"
                class="match-badge badge-skipped"
                >去重</span
              >
              <span v-if="item.matched" class="match-badge badge-matched"
                >命中</span
              >
              <span v-if="item.pushable" class="match-badge badge-pushable"
                >待入库</span
              >
              <span
                v-if="item.excludedBy === 'HIT_AND_RUN'"
                class="match-badge badge-excluded"
                >H&R 已过滤</span
              >
              {{ item.title }}
            </strong>
            <span
              >{{ formatBytes(item.size) }} ·
              {{ discountText(item.discountType) }} · {{ freeEndText(item) }} ·
              做种 {{ item.seeders ?? 0 }}</span
            >
          </article>
          <div v-if="testResult.fetchedCount === 0" class="empty-tip">
            未抓到任何种子，无法匹配。
          </div>
          <div v-else-if="testResult.pushableCount === 0" class="empty-tip">
            没有命中当前任务规则的种子。
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { Snackbar } from "@varlet/ui";
import { SegmentedButtons } from "@varlet/ui";
import AppSelect from "../components/AppSelect.vue";
import AppActionMenu, {
  type AppActionMenuItem,
} from "../components/AppActionMenu.vue";
import CCPageHeader from "../components/CCPageHeader.vue";
import CCStateView from "../components/CCStateView.vue";
import { useMediaQuery } from "../composables/useMediaQuery";
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import AppLayout from "../components/AppLayout.vue";
import { getDownloaders, type DownloaderListItem } from "../api/downloaders";
import { getSites, type SiteListItem } from "../api/sites";
import {
  createTask,
  deleteTask,
  exportTasks,
  getTasks,
  importTasks,
  runTask,
  testTask,
  updateTask,
  updateTaskAutoRun,
  type DiscountType,
  type TaskItem,
  type TaskPayload,
  type TaskSortRule,
  type TaskStats,
  type TaskTestResult,
} from "../api/tasks";

const items = ref<TaskItem[]>([]);
const router = useRouter();
const total = ref(0);
const stats = ref<TaskStats>({
  total: 0,
  autoRunEnabled: 0,
  running: 0,
  failed: 0,
});
const sites = ref<SiteListItem[]>([]);
const downloaders = ref<DownloaderListItem[]>([]);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const formVisible = ref(false);
const editingTaskId = ref<string>();
const testResult = ref<TaskTestResult>();
const testingTaskId = ref<string>();
const showOnlyFreeDownloadHint = ref(false);
const importInputRef = ref<HTMLInputElement>();

const filters = reactive({
  keyword: "",
  autoRun: "ALL" as "ALL" | "ON" | "OFF",
});
const form = reactive<
  TaskPayload & {
    torrentCount: number;
    lowUploadKbps: number;
    lowUploadMinutes: number;
    sortRule: TaskSortRule | "";
  }
>({
  name: "",
  siteId: "",
  downloaderId: "",
  autoRunEnabled: false,
  intervalMinutes: 30,
  onlyFreeDownload: true,
  deleteOnFreeExpire: false,
  skipHitAndRun: true,
  lowUploadKbps: 0,
  lowUploadMinutes: 0,
  autoPush: true,
  discountTypes: ["FREE", "TWO_X_FREE"],
  seederMin: 0,
  seederMax: 0,
  sizeMinGb: 0,
  sizeMaxGb: 0,
  torrentCountCondition: "",
  torrentCount: 0,
  sortRule: "",
  fetchLimit: 100,
  savePathOverride: "",
});

const discountOptions: Array<{ value: DiscountType; label: string }> = [
  { value: "FREE", label: "FREE" },
  { value: "TWO_X_FREE", label: "2X FREE" },
  { value: "HALF_FREE", label: "50% FREE" },
  { value: "NORMAL", label: "不免费" },
];

const sortRuleOptions: Array<{ value: TaskSortRule; label: string }> = [
  { value: "SEEDERS_ASC", label: "做种人数最少在前" },
  { value: "SEEDERS_DESC", label: "做种人数最多在前" },
  { value: "CREATED_DESC", label: "发布时间最新在前" },
  { value: "CREATED_ASC", label: "发布时间最久在前" },
  { value: "SIZE_DESC", label: "种子体积最大在前" },
  { value: "SIZE_ASC", label: "种子体积最小在前" },
];

// 工具栏过滤器段控件选项
const autoRunFilterOptions = [
  { label: "全部", value: "ALL" },
  { label: "已开启", value: "ON" },
  { label: "已关闭", value: "OFF" },
];

// 表单内 Select 选项
const siteOptions = computed(() =>
  sites.value.map((s) => ({ label: s.displayName, value: s.id })),
);
const downloaderOptions = computed(() =>
  downloaders.value.map((d) => ({ label: d.name, value: d.id })),
);
const sortRuleSelectOptions = sortRuleOptions.map((o) => ({
  label: o.label,
  value: o.value,
}));

const statCards = computed(() => [
  { label: "全部任务", value: stats.value.total, className: "" },
  {
    label: "自动执行",
    value: stats.value.autoRunEnabled,
    className: "success",
  },
  { label: "运行中", value: stats.value.running, className: "warning" },
  { label: "失败", value: stats.value.failed, className: "danger" },
]);

// 响应式判断：移动端 < 768px 使用 varlet 组件优化体验
const isDesktop = useMediaQuery("(min-width: 768px)");

function resetForm() {
  editingTaskId.value = undefined;
  Object.assign(form, {
    name: "",
    siteId: sites.value[0]?.id || "",
    downloaderId: downloaders.value[0]?.id || "",
    autoRunEnabled: false,
    intervalMinutes: 30,
    onlyFreeDownload: true,
    deleteOnFreeExpire: false,
    skipHitAndRun: true,
    lowUploadKbps: 0,
    lowUploadMinutes: 0,
    autoPush: true,
    discountTypes: ["FREE", "TWO_X_FREE"],
    seederMin: 0,
    seederMax: 0,
    sizeMinGb: 0,
    sizeMaxGb: 0,
    torrentCountCondition: "",
    torrentCount: 0,
    sortRule: "",
    fetchLimit: 100,
    savePathOverride: "",
    categoryOverride: undefined,
    tagsOverride: undefined,
  });
}

function openCreate() {
  resetForm();
  showOnlyFreeDownloadHint.value = false;
  formVisible.value = true;
}

function openEdit(task: TaskItem) {
  editingTaskId.value = task.id;
  showOnlyFreeDownloadHint.value = false;
  Object.assign(form, {
    name: task.name,
    siteId: task.siteId,
    downloaderId: task.downloaderId,
    autoRunEnabled: task.autoRunEnabled,
    intervalMinutes: task.intervalMinutes,
    onlyFreeDownload: task.onlyFreeDownload ?? false,
    deleteOnFreeExpire: task.deleteOnFreeExpire ?? false,
    skipHitAndRun: task.skipHitAndRun ?? true,
    lowUploadKbps: task.lowUploadKbps ?? 0,
    lowUploadMinutes: task.lowUploadMinutes ?? 0,
    autoPush: task.autoPush,
    discountTypes: [...task.discountTypes],
    seederMin: task.seederMin ?? 0,
    seederMax: task.seederMax ?? 0,
    sizeMinGb: task.sizeMinGb ?? 0,
    sizeMaxGb: task.sizeMaxGb ?? 0,
    torrentCountCondition: task.torrentCountCondition ?? "",
    torrentCount: task.torrentCount ?? 0,
    sortRule: task.sortRule ?? "",
    fetchLimit: task.fetchLimit ?? 100,
    savePathOverride: task.savePathOverride,
    categoryOverride: task.categoryOverride,
    tagsOverride: task.tagsOverride,
  });
  formVisible.value = true;
}

function validateForm() {
  if (!form.name.trim()) return "任务名称不能为空";
  if (!form.siteId) return "请选择站点";
  if (!form.downloaderId) return "请选择下载器";
  if (!Number.isInteger(form.intervalMinutes) || form.intervalMinutes < 10)
    return "执行间隔不能小于 10 分钟";
  if (!form.discountTypes.length) return "请至少选择一种优惠类型";
  if (!Number.isInteger(form.seederMin) || (form.seederMin ?? 0) < 0)
    return "最小做种人数必须是大于等于 0 的整数";
  if (!Number.isInteger(form.seederMax) || (form.seederMax ?? 0) < 0)
    return "最大做种人数必须是大于等于 0 的整数";
  if (
    (form.seederMin ?? 0) > 0 &&
    (form.seederMax ?? 0) > 0 &&
    (form.seederMin ?? 0) > (form.seederMax ?? 0)
  )
    return "最小做种人数不能大于最大做种人数";
  if (!Number.isInteger(form.sizeMinGb) || (form.sizeMinGb ?? 0) < 0)
    return "种子最小体积必须是大于等于 0 的整数";
  if (!Number.isInteger(form.sizeMaxGb) || (form.sizeMaxGb ?? 0) < 0)
    return "种子最大体积必须是大于等于 0 的整数";
  if (
    (form.sizeMinGb ?? 0) > 0 &&
    (form.sizeMaxGb ?? 0) > 0 &&
    (form.sizeMinGb ?? 0) > (form.sizeMaxGb ?? 0)
  )
    return "种子最小体积不能大于种子最大体积";
  if ((form.torrentCount ?? 0) > 0 && !Number.isInteger(form.torrentCount))
    return "入库数量必须是非负整数";
  const fetchLimit = Number(form.fetchLimit) || 0;
  if (!Number.isInteger(fetchLimit) || fetchLimit < 1 || fetchLimit > 1000)
    return "抓取数量必须是 1 到 1000 之间的整数";
  const kbps = Number(form.lowUploadKbps) || 0;
  const mins = Number(form.lowUploadMinutes) || 0;
  if (kbps > 0 !== mins > 0) return "低速删除的速度阈值和持续时间需同时填写";
  if (kbps > 0 && (!Number.isInteger(kbps) || kbps < 1))
    return "低速删除的速度阈值必须是大于等于 1 的整数";
  if (mins > 0 && (!Number.isInteger(mins) || mins < 1))
    return "低速删除的持续时间必须是大于等于 1 的整数";
  return "";
}

async function loadTasks() {
  loading.value = true;
  error.value = "";
  try {
    const result = await getTasks(filters);
    items.value = result.items;
    total.value = result.total;
    stats.value = result.stats;
  } catch (err) {
    error.value = err instanceof Error ? err.message : "任务列表加载失败";
  } finally {
    loading.value = false;
  }
}

async function loadOptions() {
  const [siteResult, downloaderResult] = await Promise.all([
    getSites({ page: 1, pageSize: 100 }),
    getDownloaders({}),
  ]);
  sites.value = siteResult.items;
  downloaders.value = downloaderResult.items;
}

async function saveTask() {
  const validation = validateForm();
  if (validation) {
    Snackbar.warning(validation);
    return;
  }
  saving.value = true;
  try {
    const payload: TaskPayload = {
      name: form.name,
      siteId: form.siteId,
      downloaderId: form.downloaderId,
      autoRunEnabled: form.autoRunEnabled,
      intervalMinutes: form.intervalMinutes,
      onlyFreeDownload: form.onlyFreeDownload,
      deleteOnFreeExpire: form.deleteOnFreeExpire,
      skipHitAndRun: form.skipHitAndRun,
      lowUploadKbps:
        (form.lowUploadKbps ?? 0) > 0 ? Number(form.lowUploadKbps) : null,
      lowUploadMinutes:
        (form.lowUploadMinutes ?? 0) > 0 ? Number(form.lowUploadMinutes) : null,
      autoPush: form.autoPush,
      discountTypes: form.discountTypes,
      seederMin: form.seederMin,
      seederMax: form.seederMax,
      sizeMinGb: form.sizeMinGb,
      sizeMaxGb: form.sizeMaxGb,
      torrentCountCondition: (form.torrentCount ?? 0) > 0 ? "LT" : "",
      torrentCount: form.torrentCount,
      sortRule: form.sortRule || undefined,
      fetchLimit: Number(form.fetchLimit) || 100,
      savePathOverride: form.savePathOverride,
      categoryOverride: form.categoryOverride,
      tagsOverride: form.tagsOverride,
    };
    if (editingTaskId.value) await updateTask(editingTaskId.value, payload);
    else await createTask(payload);
    Snackbar.success("任务已保存");
    formVisible.value = false;
    await loadTasks();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "保存失败");
  } finally {
    saving.value = false;
  }
}

async function toggleAutoRun(task: TaskItem) {
  try {
    await updateTaskAutoRun(task.id, !task.autoRunEnabled);
    Snackbar.success(
      !task.autoRunEnabled ? "自动执行已开启" : "自动执行已关闭",
    );
    await loadTasks();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "操作失败");
  }
}

async function testExistingTask(task: TaskItem) {
  if (testingTaskId.value) return;
  testingTaskId.value = task.id;
  try {
    testResult.value = await testTask(task.id);
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "测试失败");
  } finally {
    testingTaskId.value = undefined;
  }
}

async function runExistingTask(task: TaskItem) {
  try {
    task.running = true;
    task.lastSummary = "运行中";
    const result = await runTask(task.id);
    Snackbar.success(result.summary);
    await loadTasks();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "运行失败");
    await loadTasks();
  }
}

async function removeTask(task: TaskItem) {
  if (!window.confirm(`确认删除任务「${task.name}」？已抓取种子不会删除。`))
    return;
  await deleteTask(task.id);
  Snackbar.success("任务已删除");
  await loadTasks();
}

function taskMenuItems(task: TaskItem): AppActionMenuItem[] {
  return [
    {
      key: "test",
      label: testingTaskId.value === task.id ? "测试中..." : "测试规则",
      mobileOnly: true,
      disabled: task.running || testingTaskId.value === task.id,
    },
    {
      key: "edit",
      label: "编辑任务",
      disabled: task.running,
      disabledReason: task.running ? "任务运行中" : undefined,
    },
    { key: "logs", label: "查看任务日志" },
    {
      key: "delete",
      label: "删除任务",
      tone: "danger",
      disabled: task.running,
      disabledReason: task.running ? "任务运行中" : undefined,
    },
  ];
}

function handleTaskMenu(task: TaskItem, key: string) {
  if (key === "test") void testExistingTask(task);
  else if (key === "edit") openEdit(task);
  else if (key === "logs")
    void router.push({ path: "/logs", query: { type: "task" } });
  else if (key === "delete") void removeTask(task);
}

function formatBytes(value?: number) {
  if (value === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: unitIndex ? 2 : 0 }).format(size)} ${units[unitIndex]}`;
}

function formatDate(value?: string) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";
}

function discountText(value: string) {
  return value === "TWO_X_FREE"
    ? "2X FREE"
    : value === "HALF_FREE"
      ? "50% FREE"
      : value === "NORMAL"
        ? "不免费"
        : value;
}

function freeEndText(item: TaskTestResult["items"][number]) {
  if (item.freeEndAt) return `免费至 ${formatDate(item.freeEndAt)}`;
  if (item.isFreeNow) return "免费中，未获取到过期时间";
  return "非免费";
}

function rangeText(task: TaskItem) {
  const parts = [task.discountTypes.map(discountText).join(", ")];
  if (task.onlyFreeDownload) parts.push("仅免费下载");
  if (task.deleteOnFreeExpire) parts.push("免费到期");
  if (task.skipHitAndRun !== false) parts.push("跳过 HR");
  if (task.lowUploadKbps && task.lowUploadMinutes)
    parts.push(`低速 ${task.lowUploadKbps}KB/s·${task.lowUploadMinutes}分钟`);
  const seederMin = task.seederMin ?? 0;
  const seederMax = task.seederMax ?? 0;
  if (seederMin > 0 || seederMax > 0) {
    if (seederMin > 0 && seederMax > 0)
      parts.push(`做种 ${seederMin}~${seederMax}`);
    else if (seederMin > 0) parts.push(`做种 ≥ ${seederMin}`);
    else parts.push(`做种 ≤ ${seederMax}`);
  }
  const sizeMin = task.sizeMinGb ?? 0;
  const sizeMax = task.sizeMaxGb ?? 0;
  if (sizeMin > 0 || sizeMax > 0) {
    if (sizeMin > 0 && sizeMax > 0) parts.push(`体积 ${sizeMin}~${sizeMax} GB`);
    else if (sizeMin > 0) parts.push(`体积 ≥ ${sizeMin} GB`);
    else parts.push(`体积 ≤ ${sizeMax} GB`);
  }
  if (task.torrentCountCondition && (task.torrentCount ?? 0) > 0)
    parts.push(`入库数量 ${task.torrentCount}`);
  parts.push(`抓取数量 ${task.fetchLimit ?? 100}`);
  if (task.sortRule) {
    const opt = sortRuleOptions.find((item) => item.value === task.sortRule);
    if (opt) parts.push(`排序：${opt.label}`);
  }
  return parts.join(" · ");
}

function statusText(task: TaskItem) {
  if (task.running)
    return task.lastRunMode === "AUTO" ? "定时运行中" : "手动运行中";
  if (task.lastStatus === "SUCCESS") return "成功";
  if (task.lastStatus === "FAILED") return "失败";
  return "未运行";
}

function statusClass(task: TaskItem) {
  if (task.running) return "warning-chip";
  if (task.lastStatus === "FAILED") return "offline-chip";
  if (task.lastStatus === "SUCCESS") return "online-chip";
  return "muted-chip";
}

async function handleExport() {
  try {
    const { blob, filename } = await exportTasks();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    Snackbar.success("任务配置已导出");
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "导出失败");
  }
}

function triggerImport() {
  importInputRef.value?.click();
}

async function handleImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const result = await importTasks(file);
    Snackbar.success(
      `导入完成：成功 ${result.imported} 个，失败 ${result.failed} 个`,
    );
    if (result.errors.length) {
      result.errors.forEach((msg) => Snackbar.warning(msg));
    }
    await loadTasks();
  } catch (err) {
    Snackbar.error(err instanceof Error ? err.message : "导入失败");
  } finally {
    input.value = "";
  }
}

onMounted(async () => {
  await loadOptions();
  await loadTasks();
});
</script>
