<template>
  <div class="command-shell">
    <aside class="command-sidebar">
      <router-link
        class="command-brand"
        to="/dashboard"
        aria-label="PT Automation 首页"
      >
        <span class="command-brand-icon"
          ><img src="/pta-icon.png" alt=""
        /></span>
        <span
          ><strong>PT Automation</strong><small>PT 自动化管理平台</small></span
        >
      </router-link>
      <div class="command-nav-group">
        <span class="command-nav-label">工作台</span>
        <nav aria-label="工作台导航">
          <router-link
            v-for="item in workNavItems"
            :key="item.to"
            class="command-nav-item"
            :to="item.to"
          >
            <i aria-hidden="true">{{ item.icon }}</i
            ><span>{{ item.label }}</span>
          </router-link>
        </nav>
      </div>
      <div class="command-nav-group secondary">
        <span class="command-nav-label">系统</span>
        <nav aria-label="系统导航">
          <router-link
            v-for="item in systemNavItems"
            :key="item.to"
            class="command-nav-item"
            :to="item.to"
          >
            <i aria-hidden="true">{{ item.icon }}</i
            ><span>{{ item.label }}</span>
          </router-link>
        </nav>
      </div>
      <div class="command-sidebar-user">
        <span class="command-avatar">{{ userInitial }}</span>
        <span
          ><strong>{{ auth.user?.username }}</strong
          ><small>管理员</small></span
        >
        <button type="button" aria-label="退出登录" @click="handleLogout">
          ↗
        </button>
      </div>
    </aside>

    <header class="command-topbar">
      <div class="command-mobile-brand">
        <span class="command-brand-icon"
          ><img src="/pta-icon.png" alt="" /></span
        ><strong>PT Automation</strong>
      </div>
      <div class="command-page-context">
        <span>PT AUTOMATION</span><strong>{{ currentPage }}</strong>
      </div>
      <div class="command-topbar-spacer" />
      <span class="command-connection"><i /> 服务已连接</span>
      <span class="command-topbar-user">{{ auth.user?.username }}</span>
      <button class="command-logout" type="button" @click="handleLogout">
        退出
      </button>
    </header>

    <button
      v-if="mobileMenuOpen"
      class="command-drawer-backdrop"
      type="button"
      aria-label="关闭更多功能"
      @click="closeMobileMenu"
    />
    <aside
      id="mobile-more-navigation"
      class="command-drawer"
      :class="{ open: mobileMenuOpen }"
      aria-label="更多功能"
    >
      <div class="command-drawer-head">
        <div>
          <strong>更多功能</strong><span>{{ auth.user?.username }}</span>
        </div>
        <button
          type="button"
          aria-label="关闭更多功能"
          @click="closeMobileMenu"
        >
          ×
        </button>
      </div>
      <nav>
        <router-link
          v-for="item in moreNavItems"
          :key="item.to"
          :to="item.to"
          @click="closeMobileMenu"
          ><i aria-hidden="true">{{ item.icon }}</i
          ><span>{{ item.label }}</span
          ><b>›</b></router-link
        >
      </nav>
      <button class="command-drawer-logout" type="button" @click="handleLogout">
        退出登录
      </button>
    </aside>

    <main class="command-content"><slot /></main>

    <nav class="command-bottom-nav" aria-label="移动端主导航">
      <router-link v-for="item in mobileNavItems" :key="item.to" :to="item.to"
        ><i aria-hidden="true">{{ item.icon }}</i
        ><span>{{ item.shortLabel }}</span></router-link
      >
      <button
        type="button"
        :class="{ active: isMoreActive || mobileMenuOpen }"
        :aria-expanded="mobileMenuOpen"
        aria-controls="mobile-more-navigation"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        <i aria-hidden="true">•••</i><span>更多</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

type NavItem = { label: string; shortLabel: string; to: string; icon: string };
const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const mobileMenuOpen = ref(false);
const workNavItems: NavItem[] = [
  { label: "首页", shortLabel: "首页", to: "/dashboard", icon: "◈" },
  { label: "站点", shortLabel: "站点", to: "/sites", icon: "◉" },
  { label: "下载器", shortLabel: "下载器", to: "/downloaders", icon: "⇣" },
  { label: "任务", shortLabel: "任务", to: "/tasks", icon: "✓" },
  { label: "种子", shortLabel: "种子", to: "/torrents", icon: "◇" },
  { label: "流量", shortLabel: "流量", to: "/statistics", icon: "⌁" },
];
const systemNavItems: NavItem[] = [
  { label: "通知", shortLabel: "通知", to: "/notifications", icon: "◆" },
  { label: "日志", shortLabel: "日志", to: "/logs", icon: "≡" },
  { label: "系统", shortLabel: "系统", to: "/settings", icon: "⚙" },
];
const allNavItems = [...workNavItems, ...systemNavItems];
const mobileNavItems = [
  workNavItems[0],
  workNavItems[1],
  workNavItems[3],
  workNavItems[4],
];
const moreNavItems = [workNavItems[2], workNavItems[5], ...systemNavItems];
const currentPage = computed(
  () =>
    allNavItems.find((item) =>
      item.to === "/"
        ? item.to === route.path
        : route.path === item.to || route.path.startsWith(`${item.to}/`),
    )?.label ?? "运行指挥台",
);
const isMoreActive = computed(() =>
  moreNavItems.some((item) => item.to === route.path),
);
const userInitial = computed(
  () => auth.user?.username?.slice(0, 1).toUpperCase() || "A",
);

function closeMobileMenu() {
  mobileMenuOpen.value = false;
}
async function handleLogout() {
  closeMobileMenu();
  await auth.logout();
  await router.replace("/login");
}
watch(() => route.fullPath, closeMobileMenu);
</script>
