import type { SiteRecord } from '../../storage.js'

export type SigninRunMode = 'AUTO' | 'MANUAL'

export type SigninContext = {
  runMode: SigninRunMode
  triggerSource: 'scheduler' | 'manual-button'
  now: Date
}

export type SigninResult = {
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED'
  message: string
  errorMessage?: string
  durationMs?: number
}

export type SigninHandler = {
  match: (site: SiteRecord) => boolean
  signin: (site: SiteRecord, ctx: SigninContext) => Promise<SigninResult>
}
