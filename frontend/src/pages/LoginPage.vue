<template>
  <div class="login-page">
    <section class="login-hero">
      <div class="logo-box">
        <img src="/pta-icon.png" alt="PTA" />
      </div>
      <h1>PT Automation</h1>
      <p>Free torrent monitor for NAS</p>
      <p class="hero-desc">按任务抓取 PT 站点种子，推送到下载器，并持续追踪站点健康状态。</p>
      <div class="hero-tags">
        <span>NAS Ready</span>
        <span>Vue 3 + Varlet</span>
      </div>
    </section>

    <form class="login-card" @submit.prevent="handleSubmit">
      <h2>登录</h2>
      <p>管理你的 PT 自动化任务</p>

      <label>
        用户名
        <input v-model.trim="form.username" :disabled="submitting" autocomplete="username" />
      </label>
      <label>
        密码
        <div class="password-input">
          <input
            v-model="form.password"
            :disabled="submitting"
            :type="passwordVisible ? 'text' : 'password'"
            autocomplete="current-password"
          />
          <button type="button" :disabled="submitting" @click="passwordVisible = !passwordVisible">
            {{ passwordVisible ? '隐藏' : '显示' }}
          </button>
        </div>
      </label>

      <button class="primary-button" type="submit" :disabled="submitting">
        {{ submitting ? '登录中...' : '登录' }}
      </button>
      <div class="login-note">登录失败时通过 snackbar 显示明确错误提示</div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Snackbar } from '@varlet/ui'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const submitting = ref(false)
const passwordVisible = ref(false)
const form = reactive({ username: 'admin', password: '' })

async function handleSubmit() {
  if (!form.username || !form.password) {
    Snackbar.warning('用户名和密码不能为空')
    return
  }

  submitting.value = true
  try {
    await auth.login({ username: form.username, password: form.password })
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch (error) {
    Snackbar.error(error instanceof Error ? error.message : '登录失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>
