<template>
  <div class="login-page">
    <section class="login-hero">
      <div class="logo-box">
        <img src="/pta-icon.png" alt="PTA" />
      </div>
      <h1>PT Automation</h1>
      <p>Free torrent monitor for NAS</p>
      <p class="hero-desc">首次启动需要设置管理员密码，设置完成后才能使用所有功能。</p>
    </section>

    <form class="login-card" @submit.prevent="handleSubmit">
      <h2>设置管理员密码</h2>
      <p>密码需 8-64 位，至少包含字母和数字</p>

      <label>
        新密码
        <div class="password-input">
          <input
            v-model="form.password"
            :disabled="submitting"
            :type="passwordVisible ? 'text' : 'password'"
            autocomplete="new-password"
          />
          <button type="button" :disabled="submitting" @click="passwordVisible = !passwordVisible">
            {{ passwordVisible ? '隐藏' : '显示' }}
          </button>
        </div>
      </label>
      <label>
        确认密码
        <div class="password-input">
          <input
            v-model="form.confirmPassword"
            :disabled="submitting"
            :type="confirmVisible ? 'text' : 'password'"
            autocomplete="new-password"
          />
          <button type="button" :disabled="submitting" @click="confirmVisible = !confirmVisible">
            {{ confirmVisible ? '隐藏' : '显示' }}
          </button>
        </div>
      </label>

      <button class="primary-button" type="submit" :disabled="submitting">
        {{ submitting ? '设置中...' : '设置密码' }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { Snackbar } from '@varlet/ui'
import { useRouter } from 'vue-router'
import { setupPassword } from '../api/auth'

const router = useRouter()
const submitting = ref(false)
const passwordVisible = ref(false)
const confirmVisible = ref(false)
const form = reactive({ password: '', confirmPassword: '' })

async function handleSubmit() {
  if (!form.password) {
    Snackbar.warning('密码不能为空')
    return
  }
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(form.password)) {
    Snackbar.warning('密码需为 8-64 位，且至少包含字母和数字')
    return
  }
  if (form.password !== form.confirmPassword) {
    Snackbar.warning('两次输入的密码不一致')
    return
  }

  submitting.value = true
  try {
    await setupPassword(form.password)
    Snackbar.success('密码设置成功，请登录')
    await router.replace('/login')
  } catch (error) {
    Snackbar.error(error instanceof Error ? error.message : '设置失败，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>
