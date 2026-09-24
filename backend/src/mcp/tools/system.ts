import { z } from 'zod'
import { readSystemSettings } from '../../storage.js'
import { getAppState } from '../../appState.js'
import { getSchedulerJobs } from '../../utils/scheduler.js'
import { stat as fsStat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'

const _EmptyInput = z.object({})

async function packageVersion() {
  const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const packagePath = path.join(backendDir, 'package.json')
  try {
    const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: string }
    return pkg.version || 'dev'
  } catch {
    return 'dev'
  }
}

async function fileSize(filePath: string) {
  try {
    return (await fsStat(filePath)).size
  } catch {
    return undefined
  }
}

async function buildSystemInfo() {
  const { storagePaths, readStorageSchemaVersion, readStorageMigrationStatus } = await import('../../storage.js')
  return {
    version: await packageVersion(),
    runtimeEnv: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
    startedAt: getAppState().startedAt,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    database: {
      type: 'sqlite' as const,
      path: storagePaths.dbFile,
      sizeBytes: await fileSize(storagePaths.dbFile),
      schemaVersion: await readStorageSchemaVersion(),
      lastMigrationStatus: await readStorageMigrationStatus()
    },
    paths: {
      dataDir: storagePaths.dataDir,
      logDir: storagePaths.logDir,
      cacheDir: storagePaths.cacheDir,
      backupDir: storagePaths.backupDir
    }
  }
}

export async function getSettingsTool() {
  const settings = await readSystemSettings()
  const { proxyTestUrl: _proxyTestUrl, ...publicSettings } = settings
  void _proxyTestUrl
  return publicSettings
}

export async function getSystemInfo() {
  return buildSystemInfo()
}

export async function getSchedulerJobsTool() {
  return getSchedulerJobs()
}

export async function getAppStateTool() {
  const state = getAppState()
  return {
    status: state.status,
    schemaVersion: state.schemaVersion,
    dbVersion: state.dbVersion,
    startedAt: state.startedAt,
    migration: state.migration
  }
}

export const systemToolDefs = {
  get_settings: { input: _EmptyInput, kind: 'read' as const },
  get_system_info: { input: _EmptyInput, kind: 'read' as const },
  get_scheduler_jobs: { input: _EmptyInput, kind: 'read' as const },
  get_app_state: { input: _EmptyInput, kind: 'read' as const }
}