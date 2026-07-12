<template>
  <span class="cc-status-tag" :class="`is-${tone}`"
    ><i aria-hidden="true" />{{ label }}</span
  >
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    tone?: "neutral" | "info" | "success" | "warning" | "danger" | "running";
  }>(),
  { tone: "neutral" },
);
</script>
