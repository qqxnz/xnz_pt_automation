import { createRouter, createWebHistory } from 'vue-router'
import LoginPage from '../pages/LoginPage.vue'
import SetupPage from '../pages/SetupPage.vue'
import DashboardPage from '../pages/DashboardPage.vue'
import DownloadersPage from '../pages/DownloadersPage.vue'
import LogsPage from '../pages/LogsPage.vue'
import ModulePage from '../pages/ModulePage.vue'
import SettingsPage from '../pages/SettingsPage.vue'
import SitesPage from '../pages/SitesPage.vue'
import SiteStatisticsPage from '../pages/SiteStatisticsPage.vue'
import SiteDailyHistoryPage from '../pages/SiteDailyHistoryPage.vue'
import TasksPage from '../pages/TasksPage.vue'
import TorrentsPage from '../pages/TorrentsPage.vue'
import { useAuthStore } from '../stores/auth'
import { getSetupStatus } from '../api/auth'

let setupChecked = false
let setupRequired = false

export function markSetupComplete() {
  setupRequired = false
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: LoginPage, meta: { guestOnly: true } },
    { path: '/setup', component: SetupPage },
    { path: '/dashboard', component: DashboardPage, meta: { requiresAuth: true } },
    { path: '/sites', name: 'sites', component: SitesPage, meta: { requiresAuth: true } },
    { path: '/sites/:id/history', name: 'site-daily-history', component: SiteDailyHistoryPage, meta: { requiresAuth: true } },
    { path: '/statistics', name: 'statistics', component: SiteStatisticsPage, meta: { requiresAuth: true } },
    { path: '/downloaders', name: 'downloaders', component: DownloadersPage, meta: { requiresAuth: true } },
    { path: '/tasks', name: 'tasks', component: TasksPage, meta: { requiresAuth: true } },
    { path: '/torrents', name: 'torrents', component: TorrentsPage, meta: { requiresAuth: true } },
    { path: '/logs', name: 'logs', component: LogsPage, meta: { requiresAuth: true } },
    { path: '/settings', name: 'settings', component: SettingsPage, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
  ]
})

router.beforeEach(async (to) => {
  if (!setupChecked && to.path !== '/setup') {
    try {
      const result = await getSetupStatus()
      setupRequired = result.setupRequired
    } catch {
      // 忽略错误，默认不阻止
    }
    setupChecked = true
  }

  if (setupRequired && to.path !== '/setup') {
    return '/setup'
  }

  if (to.path === '/setup') {
    if (!setupRequired) return '/login'
    return true
  }

  const auth = useAuthStore()

  if (!auth.initialized) {
    await auth.fetchMe().catch(() => undefined)
  }

  if (to.meta.requiresAuth && !auth.user) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (to.meta.guestOnly && auth.user) {
    return '/dashboard'
  }

  return true
})
