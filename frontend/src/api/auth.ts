import { apiRequest } from './client'

export type User = {
  id: string
  username: string
  passwordChangedAt?: string
  lastLoginAt?: string
}

export function getSetupStatus() {
  return apiRequest<{ setupRequired: boolean }>('/api/auth/setup-status')
}

export function setupPassword(password: string) {
  return apiRequest<{ success: boolean }>('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ password })
  })
}

export function login(payload: { username: string; password: string }) {
  return apiRequest<{ user: User; sessionToken: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export function logout() {
  return apiRequest<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
}

export function getMe() {
  return apiRequest<{ user: User }>('/api/auth/me')
}
