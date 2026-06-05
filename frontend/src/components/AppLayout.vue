<template>
  <div class="app-shell">
    <header class="topbar">
      <button
        class="mobile-menu-button"
        type="button"
        :aria-expanded="mobileMenuOpen"
        aria-controls="mobile-navigation"
        aria-label="打开模块菜单"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <span />
        <span />
        <span />
      </button>
      <div class="brand-mark">PT</div>
      <div class="brand-title">PT Automation</div>
      <div class="topbar-spacer" />
      <span class="username">{{ auth.user?.username }}</span>
      <router-link class="text-button hide-mobile" to="/settings">系统设置</router-link>
      <button class="text-button" type="button" @click="handleLogout">退出</button>
    </header>

    <aside class="sidebar">
      <router-link v-for="item in navItems" :key="item.to" class="nav-item" :to="item.to">
        {{ item.label }}
      </router-link>
    </aside>

    <button
      v-if="mobileMenuOpen"
      class="mobile-nav-backdrop"
      type="button"
      aria-label="关闭模块菜单"
      @click="closeMobileMenu"
    />

    <nav
      id="mobile-navigation"
      class="mobile-nav"
      :class="{ open: mobileMenuOpen }"
      aria-label="模块导航"
    >
      <div class="mobile-nav-head">
        <span>切换模块</span>
        <button type="button" aria-label="关闭模块菜单" @click="closeMobileMenu">×</button>
      </div>
      <router-link
        v-for="item in navItems"
        :key="item.to"
        class="mobile-nav-item"
        :to="item.to"
        @click="closeMobileMenu"
      >
        {{ item.label }}
      </router-link>
    </nav>

    <main class="content"><slot /></main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const mobileMenuOpen = ref(false)

const navItems = [
  { label: '首页', to: '/dashboard' },
  { label: '站点', to: '/sites' },
  { label: '下载器', to: '/downloaders' },
  { label: '任务', to: '/tasks' },
  { label: '种子', to: '/torrents' },
  { label: '日志', to: '/logs' },
  { label: '系统', to: '/settings' }
]

function closeMobileMenu() {
  mobileMenuOpen.value = false
}

async function handleLogout() {
  await auth.logout()
  await router.replace('/login')
}

watch(
  () => route.fullPath,
  () => closeMobileMenu()
)
</script>
