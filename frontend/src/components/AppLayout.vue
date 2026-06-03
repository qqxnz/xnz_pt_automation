<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-mark">PT</div>
      <div class="brand-title">PT Automation</div>
      <div class="topbar-spacer" />
      <span class="username">{{ auth.user?.username }}</span>
      <button class="text-button hide-mobile" type="button">系统设置</button>
      <button class="text-button" type="button" @click="handleLogout">退出</button>
    </header>

    <aside class="sidebar">
      <router-link class="nav-item" to="/dashboard">Dashboard</router-link>
      <router-link class="nav-item" to="/sites">站点</router-link>
      <router-link class="nav-item" to="/torrents">种子</router-link>
      <router-link class="nav-item" to="/downloaders">下载器</router-link>
      <router-link class="nav-item" to="/proxies">代理管理</router-link>
      <router-link class="nav-item" to="/tasks">任务</router-link>
      <router-link class="nav-item" to="/settings">系统设置</router-link>
    </aside>

    <main class="content"><slot /></main>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const auth = useAuthStore()

async function handleLogout() {
  await auth.logout()
  await router.replace('/login')
}
</script>
