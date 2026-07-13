<template>
  <main class="auth-shell">
    <section class="auth-brand-panel">
      <div class="auth-brand-lockup">
        <div class="auth-brand-icon"><img src="/pta-icon.png" alt="" /></div>
        <div><strong>PT Automation</strong><span>PT 自动化管理平台</span></div>
      </div>
      <div class="auth-brand-copy">
        <span class="auth-eyebrow">{{ eyebrow }}</span>
        <h1>{{ title }}</h1>
        <p>{{ description }}</p>
      </div>
      <div class="auth-capabilities" aria-label="系统能力">
        <span>站点健康检查</span><span>自动任务调度</span
        ><span>下载器状态追踪</span>
      </div>
      <div class="auth-deploy-note">
        <strong>{{ noteTitle }}</strong
        ><span>{{ note }}</span>
      </div>
    </section>
    <section class="auth-form-panel">
      <div class="auth-mobile-brand">
        <div class="auth-brand-icon"><img src="/pta-icon.png" alt="" /></div>
        <div><strong>PT Automation</strong><span>PT 自动化管理平台</span></div>
      </div>
      <div class="auth-form-wrap"><slot /></div>
      <p class="auth-footer">PT Automation · 私有部署的 PT 自动化工具</p>
    </section>
  </main>
</template>

<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  description: string;
  noteTitle: string;
  note: string;
}>();
</script>
