import { apiRequest } from './client'

export type NotificationProvider = 'IYUU'
export type NotificationEvent = 'SITE_SIGNIN' | 'TASK_TRIGGERED' | 'TORRENT_ADDED' | 'TORRENT_DELETED'

export type NotificationListItem = {
  id: string
  name: string
  provider: NotificationProvider
  enabled: boolean
  events: NotificationEvent[]
  hasToken: boolean
  createdAt: string
  updatedAt: string
  lastResult?: {
    status: 'SUCCESS' | 'FAILED'
    event: NotificationEvent | 'TEST'
    title: string
    errorMessage?: string
    createdAt: string
  }
}

export type NotificationPayload = {
  name: string
  provider: NotificationProvider
  enabled: boolean
  token?: string
  tokenAction: 'KEEP' | 'UPDATE'
  events: NotificationEvent[]
}

export type NotificationStats = { total: number; enabled: number; failed: number }

export function getNotifications() {
  return apiRequest<{ items: NotificationListItem[]; total: number; stats: NotificationStats }>('/api/notifications')
}

export function createNotification(payload: NotificationPayload) {
  return apiRequest<NotificationListItem>('/api/notifications', { method: 'POST', body: JSON.stringify(payload) })
}

export function updateNotification(id: string, payload: NotificationPayload) {
  return apiRequest<NotificationListItem>(`/api/notifications/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
}

export function deleteNotification(id: string) {
  return apiRequest<void>(`/api/notifications/${id}`, { method: 'DELETE' })
}

export function testNotification(id: string) {
  return apiRequest<{ success: boolean; message: string }>(`/api/notifications/${id}/test`, { method: 'POST' })
}

export function testNotificationDraft(payload: NotificationPayload & { id?: string }) {
  return apiRequest<{ success: boolean; message: string }>('/api/notifications/test-draft', { method: 'POST', body: JSON.stringify(payload) })
}
