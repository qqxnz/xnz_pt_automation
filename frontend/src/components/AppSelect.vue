<template>
  <select
    v-if="isDesktop"
    :value="modelValue ?? ''"
    :disabled="disabled"
    @change="onNativeChange"
  >
    <option v-if="placeholder" value="" disabled hidden>{{ placeholder }}</option>
    <option
      v-for="option in options"
      :key="option[valueKey]"
      :value="option[valueKey]"
    >
      {{ option[labelKey] }}
    </option>
  </select>
  <Select
    v-else
    class="app-select-mobile"
    variant="outlined"
    :hint="false"
    :line="false"
    :model-value="modelValue"
    :options="options"
    :label-key="labelKey"
    :value-key="valueKey"
    :placeholder="placeholder"
    :disabled="disabled"
    :clearable="clearable"
    :rules="rules"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>

<script setup lang="ts">
import { Select } from '@varlet/ui'
import { useMediaQuery } from '../composables/useMediaQuery'

interface Option {
  label: string
  value: string | number
  [key: string]: string | number
}

withDefaults(
  defineProps<{
    modelValue?: string | number | null
    options: Option[]
    placeholder?: string
    disabled?: boolean
    clearable?: boolean
    rules?: Array<(v: unknown) => boolean | string>
    labelKey?: string
    valueKey?: string
  }>(),
  {
    placeholder: '请选择',
    disabled: false,
    clearable: false,
    labelKey: 'label',
    valueKey: 'value'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null]
}>()

const isDesktop = useMediaQuery('(min-width: 768px)')

// 原生 <select> 用 @change 同步 modelValue
function onNativeChange(event: Event) {
  const target = event.target as HTMLSelectElement
  const raw = target.value
  // 尝试还原成数字（与 options 的 value 类型一致）
  const numeric = Number(raw)
  const next = Number.isNaN(numeric) || raw === '' ? raw : numeric
  emit('update:modelValue', next)
}
</script>