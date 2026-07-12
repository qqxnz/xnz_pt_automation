<template>
  <AuthShell
    eyebrow="首次安全配置"
    title="为系统创建安全入口"
    description="首次启动需要设置管理员密码。完成后即可开始配置站点、下载器和自动化任务。"
    note-title="密码安全"
    note="密码只用于当前私有部署，请妥善保管。"
  >
    <form class="auth-card" novalidate @submit.prevent="handleSubmit">
      <span class="auth-card-eyebrow">首次使用</span>
      <h2>设置管理员密码</h2>
      <p>密码需 8-64 位，至少包含字母和数字。</p>
      <label class="auth-field"><span>管理员账号</span><input value="admin" disabled /></label>
      <label class="auth-field">
        <span>新密码</span>
        <div class="password-input">
          <input v-model="form.password" :aria-invalid="Boolean(passwordError)" :disabled="submitting" :type="passwordVisible ? 'text' : 'password'" autocomplete="new-password" />
          <button type="button" :disabled="submitting" :aria-label="passwordVisible ? '隐藏新密码' : '显示新密码'" @click="passwordVisible = !passwordVisible">{{ passwordVisible ? '隐藏' : '显示' }}</button>
        </div>
        <small v-if="passwordError" class="auth-field-error">{{ passwordError }}</small>
      </label>
      <label class="auth-field">
        <span>确认密码</span>
        <div class="password-input">
          <input v-model="form.confirmPassword" :aria-invalid="Boolean(confirmError)" :disabled="submitting" :type="confirmVisible ? 'text' : 'password'" autocomplete="new-password" />
          <button type="button" :disabled="submitting" :aria-label="confirmVisible ? '隐藏确认密码' : '显示确认密码'" @click="confirmVisible = !confirmVisible">{{ confirmVisible ? '隐藏' : '显示' }}</button>
        </div>
        <small v-if="confirmError" class="auth-field-error">{{ confirmError }}</small>
      </label>
      <button class="primary-button auth-submit" type="submit" :disabled="submitting">{{ submitting ? '设置中...' : '完成初始化' }}</button>
      <div class="auth-card-note"><span>完成后</span><strong>前往登录</strong></div>
    </form>
  </AuthShell>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Snackbar } from '@varlet/ui'
import { useRouter } from 'vue-router'
import AuthShell from '../components/AuthShell.vue'
import { markSetupComplete } from '../router'
import { setupPassword } from '../api/auth'

const router = useRouter()
const submitting = ref(false)
const passwordVisible = ref(false)
const confirmVisible = ref(false)
const attempted = ref(false)
const form = reactive({ password: '', confirmPassword: '' })
const passwordError = computed(() => {
  if (!attempted.value) return ''
  if (!form.password) return '请输入新密码'
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(form.password)) return '密码需为 8-64 位，且至少包含字母和数字'
  return ''
})
const confirmError = computed(() => {
  if (!attempted.value) return ''
  if (!form.confirmPassword) return '请再次输入密码'
  if (form.password !== form.confirmPassword) return '两次输入的密码不一致'
  return ''
})

async function handleSubmit() {
  attempted.value = true
  if (!form.password) return void Snackbar.warning('密码不能为空')
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(form.password)) return void Snackbar.warning('密码需为 8-64 位，且至少包含字母和数字')
  if (form.password !== form.confirmPassword) return void Snackbar.warning('两次输入的密码不一致')
  submitting.value = true
  try {
    await setupPassword(form.password)
    markSetupComplete()
    Snackbar.success('密码设置成功，请登录')
    await router.replace('/login')
  } catch (error) {
    Snackbar.error(error instanceof Error ? error.message : '设置失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>
