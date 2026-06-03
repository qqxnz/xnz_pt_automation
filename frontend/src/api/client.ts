import { Snackbar } from '@varlet/ui'

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    },
    ...options
  })

  if (response.status === 401) {
    if (window.location.pathname !== '/login') {
      const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
      window.history.replaceState(null, '', `/login?redirect=${encodeURIComponent(redirect)}`)
    }
    throw new Error('登录态已过期，请重新登录')
  }

  const data = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new Error(data.message ?? '请求失败，请稍后重试')
  }

  return data as T
}

export function showError(error: unknown, fallback = '请求失败，请稍后重试') {
  Snackbar.error(error instanceof Error ? error.message : fallback)
}
