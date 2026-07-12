<template>
  <div class="cc-state-view" :class="`is-${tone}`" role="status">
    <span class="cc-state-icon" aria-hidden="true">{{ icon }}</span>
    <div>
      <h3>{{ title }}</h3>
      <p v-if="description">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    tone?: "empty" | "loading" | "error";
  }>(),
  { tone: "empty" },
);
const icon = computed(() =>
  props.tone === "error" ? "!" : props.tone === "loading" ? "…" : "◇",
);
</script>
