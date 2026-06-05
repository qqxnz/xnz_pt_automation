<template>
  <AppLayout>
    <section class="module-page">
      <div class="dashboard-head">
        <div>
          <h1>{{ title }}</h1>
          <p>{{ description }}</p>
        </div>
      </div>

      <div class="module-flow" v-if="steps.length">
        <router-link v-for="step in steps" :key="step.path" class="module-step" :to="step.path">
          <span>{{ step.index }}</span>
          <strong>{{ step.title }}</strong>
          <small>{{ step.summary }}</small>
        </router-link>
      </div>

      <section class="panel">
        <h2>{{ panelTitle }}</h2>
        <div class="empty-tip">{{ emptyText }}</div>
      </section>
    </section>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '../components/AppLayout.vue'

const route = useRoute()

const moduleCopy = {
  sites: {
    title: '站点',
    description: '维护 PT 站点访问凭证和连通状态。',
    panelTitle: '站点列表',
    emptyText: '暂无站点数据。'
  },
  downloaders: {
    title: '下载器',
    description: '维护下载器连接配置，当前优先支持 qBittorrent/QB。',
    panelTitle: '下载器列表',
    emptyText: '暂无下载器数据。'
  },
  tasks: {
    title: '任务',
    description: '选择站点和下载器，设置间隔、免费规则和推送策略。',
    panelTitle: '任务列表',
    emptyText: '暂无任务数据。'
  },
  torrents: {
    title: '种子',
    description: '查看抓取到的种子、当前是否免费、推送状态和目标下载器。',
    panelTitle: '种子列表',
    emptyText: '暂无种子数据。'
  },
  settings: {
    title: '系统设置',
    description: '维护账号、安全和系统运行配置。',
    panelTitle: '设置项',
    emptyText: '暂无设置数据。'
  }
} as const

const flowSteps = [
  { index: '01', title: '新增站点', summary: '配置站点访问方式', path: '/sites' },
  { index: '02', title: '新增下载器', summary: '配置 QB 推送目标', path: '/downloaders' },
  { index: '03', title: '新建任务', summary: '设定间隔和免费规则', path: '/tasks' },
  { index: '04', title: '查看种子', summary: '检查免费和推送状态', path: '/torrents' }
]

const current = computed(() => {
  const key = route.name as keyof typeof moduleCopy
  return moduleCopy[key] ?? moduleCopy.sites
})

const title = computed(() => current.value.title)
const description = computed(() => current.value.description)
const panelTitle = computed(() => current.value.panelTitle)
const emptyText = computed(() => current.value.emptyText)
const steps = computed(() => (['sites', 'downloaders', 'tasks', 'torrents'].includes(String(route.name)) ? flowSteps : []))
</script>
