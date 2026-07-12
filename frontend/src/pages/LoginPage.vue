<template>
  <AuthShell
    eyebrow="安全登录"
    title="让自动化运行得更从容"
    description="集中管理 PT 站点、自动化任务和下载器状态，异常情况及时发现、快速处理。"
    note-title="私有部署"
    note="所有配置与运行数据均保存在你的 NAS 中。"
  >
    <form class="auth-card" novalidate @submit.prevent="handleSubmit">
      <span class="auth-card-eyebrow">欢迎回来</span>
      <h2>登录</h2>
      <p>使用管理员账号进入运行指挥台。</p>
      <label class="auth-field">
        <span>用户名</span>
        <input v-model.trim="form.username" :aria-invalid="attempted && !form.username" :disabled="submitting" autocomplete="username" />
        <small v-if="attempted && !form.username" class="auth-field-error">请输入用户名</small>
      </label>
      <label class="auth-field">
        <span>密码</span>
        <div class="password-input">
          <input v-model="form.password" :aria-invalid="attempted && !form.password" :disabled="submitting" :type="passwordVisible ? 'text' : 'password'" autocomplete="current-password" />
          <button type="button" :disabled="submitting" :aria-label="passwordVisible ? '隐藏密码' : '显示密码'" @click="passwordVisible = !passwordVisible">
            {{ passwordVisible ? '隐藏' : '显示' }}
          </button>
        </div>
        <small v-if="attempted && !form.password" class="auth-field-error">请输入密码</small>
      </label>
      <button class="primary-button auth-submit" type="submit" :disabled="submitting">{{ submitting ? '登录中...' : '登录进入系统' }}</button>
      <div class="auth-card-note"><span>默认管理员账号</span><strong>admin</strong></div>
    </form>
  </AuthShell>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Snackbar } from '@varlet/ui'
import { useRoute, useRouter } from 'vue-router'
import AuthShell from '../components/AuthShell.vue'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const submitting = ref(false)
const passwordVisible = ref(false)
const attempted = ref(false)
const form = reactive({ username: 'admin', password: '' })

async function handleSubmit() {
  attempted.value = true
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
