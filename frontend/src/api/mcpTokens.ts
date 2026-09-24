import { apiRequest } from './client'

export type McpTokenPublic = {
  id: string
  name: string
  tokenPrefix: string
  enabled: boolean
  allowWrites: boolean
  createdAt: string
  lastUsedAt?: string
  expiresAt?: string
  notes?: string
}

export type McpTokenCreatePayload = {
  name: string
  allowWrites?: boolean
  expiresAt?: string
  notes?: string
}

export type McpTokenCreateResult = {
  token: McpTokenPublic
  plaintext: string
}

export type McpTokenUpdatePayload = {
  name?: string
  enabled?: boolean
  allowWrites?: boolean
  expiresAt?: string | null
  notes?: string | null
}

export async function listMcpTokens() {
  return apiRequest<{ items: McpTokenPublic[] }>('/api/mcp/tokens')
}

export async function createMcpToken(payload: McpTokenCreatePayload) {
  return apiRequest<McpTokenCreateResult>('/api/mcp/tokens', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
}

export async function updateMcpToken(id: string, payload: McpTokenUpdatePayload) {
  return apiRequest<{ token: McpTokenPublic }>(`/api/mcp/tokens/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  })
}

export async function deleteMcpToken(id: string) {
  return apiRequest<{ success: true }>(`/api/mcp/tokens/${id}`, {
    method: 'DELETE'
  })
}