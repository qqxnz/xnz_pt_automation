<template>
  <div
    ref="root"
    class="cc-select"
    :class="{
      'is-open': open,
      'is-disabled': disabled,
      'has-error': errorText,
    }"
  >
    <button
      class="cc-select-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span :class="{ placeholder: !selectedOption }">{{
        selectedOption?.[labelKey] ?? placeholder
      }}</span>
      <i aria-hidden="true">⌄</i>
    </button>
    <button
      v-if="clearable && selectedOption && !disabled"
      class="cc-select-clear"
      type="button"
      aria-label="清空选择"
      @click.stop="clearValue"
    >
      ×
    </button>
    <button
      v-if="open && !isDesktop"
      class="cc-select-backdrop"
      type="button"
      aria-label="关闭选择面板"
      @click="close"
    />
    <div v-if="open" class="cc-select-panel" role="listbox">
      <div class="cc-select-mobile-head">
        <strong>{{ placeholder }}</strong
        ><button type="button" aria-label="关闭选择面板" @click="close">
          ×
        </button>
      </div>
      <button
        v-for="option in options"
        :key="String(option[valueKey])"
        type="button"
        role="option"
        :aria-selected="option[valueKey] === modelValue"
        :disabled="option.disabled"
        @click="choose(option)"
      >
        <span
          ><i v-if="option[valueKey] === modelValue">✓</i
          >{{ option[labelKey] }}</span
        ><small v-if="option.disabledReason">{{ option.disabledReason }}</small>
      </button>
      <div v-if="!options.length" class="cc-select-empty">暂无可选项</div>
    </div>
    <small v-if="errorText" class="cc-select-error">{{ errorText }}</small>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useMediaQuery } from "../composables/useMediaQuery";

interface Option {
  label: string;
  value: string | number;
  disabled?: boolean;
  disabledReason?: string;
  [key: string]: string | number | boolean | undefined;
}

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    options: Option[];
    placeholder?: string;
    disabled?: boolean;
    clearable?: boolean;
    rules?: Array<(v: unknown) => boolean | string>;
    labelKey?: string;
    valueKey?: string;
  }>(),
  {
    placeholder: "请选择",
    disabled: false,
    clearable: false,
    labelKey: "label",
    valueKey: "value",
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string | number | null];
}>();
const route = useRoute();
const isDesktop = useMediaQuery("(min-width: 768px)");
const root = ref<HTMLElement>();
const open = ref(false);
const touched = ref(false);
const selectedOption = computed(() =>
  props.options.find((option) => option[props.valueKey] === props.modelValue),
);
const errorText = computed(() => {
  if (!touched.value) return "";
  for (const rule of props.rules ?? []) {
    const result = rule(props.modelValue);
    if (typeof result === "string") return result;
    if (!result) return "请选择有效选项";
  }
  return "";
});

function toggle() {
  if (!props.disabled) open.value = !open.value;
}
function close() {
  open.value = false;
  touched.value = true;
}
function choose(option: Option) {
  if (!option.disabled) {
    emit("update:modelValue", option[props.valueKey] as string | number);
    close();
  }
}
function clearValue() {
  emit("update:modelValue", null);
  touched.value = true;
}
function onDocumentClick(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node))
    close();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(() => route.fullPath, close);
watch(
  () => props.modelValue,
  () => {
    if (
      props.modelValue !== undefined &&
      props.modelValue !== null &&
      props.modelValue !== ""
    )
      touched.value = true;
  },
);
onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>
