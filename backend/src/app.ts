import cookieParser from 'cookie-parser'
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAppState, migrationPercent } from './appState.js'
import { authRouter } from './routes/auth.js'
import { backupRouter } from './routes/backup.js'
import { downloadersRouter } from './routes/downloaders.js'
import { logsRouter } from './routes/logs.js'
import { settingsRouter } from './routes/settings.js'
import { sitesRouter } from './routes/sites/index.js'
import { siteStatisticsRouter } from './routes/siteStatistics.js'
import { statsRouter } from './routes/stats.js'
import { tasksRouter } from './routes/tasks.js'
import { torrentsRouter } from './routes/torrents.js'
import { requestLogger } from './utils/logger.js'

export const app = express()

app.set('trust proxy', 1)
app.use(express.json())
app.use(cookieParser())
app.use(requestLogger)

app.get('/api/health', (_req, res) => {
  const state = getAppState()
  if (state.status === 'READY') {
    res.json({ ok: true, status: 'OK', schemaVersion: state.schemaVersion, dbVersion: state.dbVersion })
    return
  }
  if (state.status === 'MIGRATING' || state.status === 'STARTING' || state.status === 'VERSION_CHECK') {
    res.status(200).json({
      ok: false,
      status: state.status,
      from: state.migration?.from,
      to: state.migration?.to,
      percent: migrationPercent(state),
      currentTable: state.migration?.currentTable
    })
    return
  }
  if (state.status === 'MIGRATION_FAILED' || state.status === 'DOWNGRADE_REJECTED') {
    res.status(200).json({
      ok: false,
      status: state.status,
      lastError: state.migration?.lastError,
      lastBackupPath: state.migration?.lastBackupPath,
      dbVersion: state.dbVersion,
      schemaVersion: state.schemaVersion
    })
    return
  }
  res.status(200).json({ ok: true, status: state.status })
})

app.use((req, res, next) => {
  if (req.path === '/api/health') return next()
  const state = getAppState()
  if (state.status === 'READY') return next()
  if (req.path.startsWith('/api/')) {
    res.status(503).json({
      error: state.status,
      message:
        state.status === 'MIGRATING'
          ? `数据库升级中（${migrationPercent(state)}%），请稍后`
          : state.status === 'MIGRATION_FAILED'
            ? `数据库升级失败，docker 将自动重启`
            : state.status === 'DOWNGRADE_REJECTED'
              ? `镜像版本低于数据库版本，拒绝启动`
              : `应用启动中（${state.status}）`,
      percent: state.migration ? migrationPercent(state) : undefined,
      lastError: state.migration?.lastError,
      lastBackupPath: state.migration?.lastBackupPath
    })
    return
  }
  next()
})

app.use('/api/auth', authRouter)
app.use('/api/backup', backupRouter)
app.use('/api/stats', statsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/sites', sitesRouter)
app.use('/api/site-statistics', siteStatisticsRouter)
app.use('/api/downloaders', downloadersRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/torrents', torrentsRouter)

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontendDist = path.resolve(backendDir, '..', 'frontend', 'dist')

if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}
