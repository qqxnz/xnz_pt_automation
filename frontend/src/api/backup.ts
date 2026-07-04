import { apiRequest, getSessionToken } from './client'

export type BackupItem = {
  name: string
  sizeBytes: number
  mtime: string
}

export type BackupListResult = {
  backups: BackupItem[]
  dataDir: string
  lastBackupAt?: string
}

export type RestoreResult = {
  restartRequired: boolean
  runtime: 'pm2' | 'docker' | 'unknown'
  safetyBackup?: BackupItem
  message: string
}

export function listBackups() {
  return apiRequest<BackupListResult>('/api/backup')
}

export function runBackup(note?: string) {
  return apiRequest<{ backup: BackupItem }>('/api/backup/run', {
    method: 'POST',
    body: JSON.stringify({ note: note ?? null })
  })
}

export function deleteBackup(name: string) {
  return apiRequest<{ deleted: string }>(`/api/backup/${encodeURIComponent(name)}`, {
    method: 'DELETE'
  })
}

export function restoreBackup(name: string) {
  return apiRequest<RestoreResult>(`/api/backup/${encodeURIComponent(name)}/restore`, {
    method: 'POST'
  })
}

export function getBackupDownloadUrl(name: string) {
  const token = getSessionToken()
  const qs = token ? `?token=${encodeURIComponent(token)}` : ''
  return `/api/backup/${encodeURIComponent(name)}/download${qs}`
}

export async function triggerBrowserDownload(name: string) {
  const url = getBackupDownloadUrl(name)
  const token = getSessionToken()
  const response = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (response.status === 401) {
    const { handleUnauthorized } = await import('./client')
    await handleUnauthorized()
    throw new Error('登录态已过期，请重新登录')
  }
  if (response.status === 404) {
    const data = (await response.json().catch(() => ({}))) as { message?: string }
    throw new Error(data.message ?? '备份文件已被移走或删除')
  }
  if (!response.ok) {
    throw new Error('下载失败，请稍后重试')
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(objectUrl)
}
