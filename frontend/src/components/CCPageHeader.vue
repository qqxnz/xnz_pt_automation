<template>
  <header class="cc-page-header">
    <div class="cc-page-header-copy">
      <span v-if="eyebrow" class="cc-eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions || meta" class="cc-page-header-actions">
      <span v-if="meta" class="cc-page-header-meta">{{ meta }}</span>
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: string;
}>();
</script>
