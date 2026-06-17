import { onBeforeUnmount, ref } from 'vue'

/**
 * 响应式监听 CSS 媒体查询。
 *
 * 用法：
 *   const isDesktop = useMediaQuery('(min-width: 768px)')
 *
 * 返回值是 ref<boolean>，会在窗口尺寸变化时自动更新。
 * SSR 安全：服务端始终返回 false（默认）。
 */
export function useMediaQuery(query: string) {
  const matches = ref(false)

  if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
    return matches
  }

  const mql = window.matchMedia(query)
  matches.value = mql.matches

  const handler = (event: MediaQueryListEvent) => {
    matches.value = event.matches
  }

  mql.addEventListener('change', handler)
  onBeforeUnmount(() => {
    mql.removeEventListener('change', handler)
  })

  return matches
}