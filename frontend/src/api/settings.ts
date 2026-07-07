import { apiRequest } from './client'

export type SystemSettings = {
  sessionTtlHours: number
  requestTimeoutMs: number
  maxConcurrentTasks: number
  defaultUserAgent: string
}

export type SystemInfo = {
  version: string
  runtimeEnv: string
  nodeVersion: string
  startedAt: string
  timezone: string
  database: {
    type: string
    path: string
    sizeBytes?: number
    schemaVersion: string
    lastMigrationAt?: string
    lastMigrationStatus?: 'SUCCESS' | 'FAILED' | 'PENDING'
    lastMigrationError?: string
  }
  paths: {
    dataDir?: string
    logDir?: string
    cacheDir?: string
    backupDir?: string
  }
}

export function getSystemInfo() {
  return apiRequest<SystemInfo>('/api/settings/system-info')
}

export function getSystemSettings() {
  return apiRequest<{ settings: SystemSettings; updatedAt?: string }>('/api/settings')
}

export function updateSystemSettings(payload: SystemSettings) {
  return apiRequest<{ settings: SystemSettings; updatedAt: string }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export function changePassword(payload: { oldPassword: string; newPassword: string }) {
  return apiRequest<{ success: true; otherSessionsRevoked: boolean }>('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}
