import { Snackbar } from '@varlet/ui'

const sessionTokenKey = 'pt_session_token'

function isLoginRequest(path: string) {
  return path === '/api/auth/login'
}

export function getSessionToken() {
  try {
    return localStorage.getItem(sessionTokenKey)
  } catch {
    return null
  }
}

export function setSessionToken(token: string) {
  try {
    localStorage.setItem(sessionTokenKey, token)
  } catch {
    // Cookie-based sessions still work when localStorage is unavailable.
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(sessionTokenKey)
  } catch {
    // Nothing to clear when the browser blocks localStorage.
  }
}

export async function handleUnauthorized() {
  if (window.location.pathname === '/login') return

  const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const [{ router }, { useAuthStore }] = await Promise.all([import('../router'), import('../stores/auth')])
  const auth = useAuthStore()

  clearSessionToken()
  auth.user = undefined
  auth.initialized = true
  await router.replace({ path: '/login', query: { redirect } })
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getSessionToken()
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {})
    },
    ...options
  })

  if (response.status === 401 && !isLoginRequest(path)) {
    await handleUnauthorized()
    throw new Error('未登录或登录凭据无效，请重新登录')
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
