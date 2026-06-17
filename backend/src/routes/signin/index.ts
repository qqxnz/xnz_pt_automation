import { randomUUID } from 'node:crypto'
import type { SigninLogRecord, SiteRecord } from '../../storage.js'
import { appendSigninLog, getSiteFromDb, updateSiteInDb } from '../../storage.js'
import { siteDisplayName } from '../sites/index.js'
import { baseNexusPhpSignin } from './baseNexusPhp.js'
import { chdbitsSignin } from './chdbits.js'
import { hdhomeSignin } from './hdhome.js'
import { hdkylSignin } from './hdkyl.js'
import { hhanclubSignin } from './hhanclub.js'
import { keepfrdsSignin } from './keepfrds.js'
import { mteamSignin } from './mteam.js'
import { ourbitsSignin } from './ourbits.js'
import { pterclubSignin } from './pterclub.js'
import { pthomeSignin } from './pthome.js'
import { pttimeSignin } from './pttime.js'
import { totheglorySignin } from './totheglory.js'
import { ubitsSignin } from './ubits.js'
import type { SigninContext, SigninHandler, SigninResult } from './types.js'

const HANDLERS: SigninHandler[] = [
  mteamSignin,
  hhanclubSignin,
  hdhomeSignin,
  hdkylSignin,
  totheglorySignin,
  keepfrdsSignin,
  chdbitsSignin,
  pterclubSignin,
  ourbitsSignin,
  pthomeSignin,
  ubitsSignin,
  pttimeSignin,
  baseNexusPhpSignin
]

const signinLocks = new Map<string, Promise<SigninResult>>()

function pickHandler(site: SiteRecord): SigninHandler {
  return HANDLERS.find((handler) => handler.match(site)) ?? baseNexusPhpSignin
}

export async function performSiteSignin(
  site: SiteRecord,
  ctx: SigninContext
): Promise<SigninResult & { siteId: string; siteName: string; logId: string; durationMs: number }> {
  const startedAt = Date.now()
  const startedAtIso = new Date(startedAt).toISOString()
  const handler = pickHandler(site)
  const result = await handler.signin(site, ctx)
  const finishedAt = Date.now()
  const durationMs = finishedAt - startedAt
  const finishedAtIso = new Date(finishedAt).toISOString()
  const log: SigninLogRecord = {
    id: randomUUID(),
    type: 'SIGNIN',
    siteId: site.id,
    siteName: siteDisplayName(site),
    runMode: ctx.runMode,
    triggerSource: ctx.triggerSource,
    status: result.status,
    message: result.message,
    errorMessage: result.errorMessage,
    startedAt: startedAtIso,
    finishedAt: finishedAtIso,
    durationMs,
    createdAt: finishedAtIso
  }
  const saved = await appendSigninLog({
    siteId: log.siteId,
    siteName: log.siteName,
    runMode: log.runMode,
    triggerSource: log.triggerSource,
    status: log.status,
    message: log.message,
    errorMessage: log.errorMessage,
    startedAt: log.startedAt,
    finishedAt: log.finishedAt,
    durationMs: log.durationMs
  })
  const updatedSite: SiteRecord = {
    ...site,
    lastSigninAt: startedAtIso,
    lastSigninStatus: result.status,
    lastSigninMessage: result.message,
    updatedAt: finishedAtIso
  }
  await updateSiteInDb(updatedSite)
  return {
    status: result.status,
    message: result.message,
    errorMessage: result.errorMessage,
    siteId: site.id,
    siteName: siteDisplayName(site),
    logId: saved.id,
    durationMs
  }
}

export async function signinSiteById(
  id: string,
  ctx: SigninContext
): Promise<SigninResult & { siteId: string; siteName: string; logId: string; durationMs: number }> {
  const existing = signinLocks.get(id) as Promise<SigninResult & { siteId: string; siteName: string; logId: string; durationMs: number }> | undefined
  if (existing) {
    return existing
  }
  const site = await getSiteFromDb(id)
  if (!site) {
    throw new Error('站点不存在')
  }
  const promise = performSiteSignin(site, ctx)
  signinLocks.set(id, promise)
  promise.finally(() => {
    signinLocks.delete(id)
  })
  return promise
}

export function isSiteSigninRunning(siteId: string) {
  return signinLocks.has(siteId)
}
