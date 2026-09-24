import type { SiteRecord } from '../../storage.js'

export type SigninRunMode = 'AUTO' | 'MANUAL'

export type SigninContext = {
  runMode: SigninRunMode
  triggerSource: 'scheduler' | 'manual-button' | 'mcp' | 'scheduler-backfill'
  now: Date
}

export type SigninResult = {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'UNSUPPORTED'
  message: string
  errorMessage?: string
  durationMs?: number
}

export type SigninHandler = {
  match: (site: SiteRecord) => boolean
  signin: (site: SiteRecord, ctx: SigninContext) => Promise<SigninResult>
}
