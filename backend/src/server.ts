import { app } from './app.js'
import { logger } from './utils/logger.js'
import { resetStuckRunningTasks } from './routes/tasks.js'
import { startScheduler } from './utils/scheduler.js'
import { initializeStorage } from './storage.js'
import { getAppState, setStatus } from './appState.js'

const port = Number(process.env.PORT ?? 3180)
const migrationFailureExitCode = 10
const downgradeRejectionExitCode = 7

app.listen(port, async () => {
  logger.info('server', `PT Automation API listening on http://localhost:${port} (waiting for storage)`)
  try {
    await initializeStorage()
  } catch (error) {
    const state = getAppState()
    if (state.status === 'DOWNGRADE_REJECTED') {
      logger.error('server', `镜像版本 v${state.schemaVersion} 低于数据库版本 v${state.dbVersion}，拒绝启动并退出 ${downgradeRejectionExitCode}`)
      process.exit(downgradeRejectionExitCode)
    }
    if (state.status === 'MIGRATION_FAILED') {
      logger.error('server', `数据库迁移失败，docker 将自动重启（exit ${migrationFailureExitCode}）`, {
        lastError: state.migration?.lastError,
        lastBackupPath: state.migration?.lastBackupPath
      })
      process.exit(migrationFailureExitCode)
    }
    logger.error('server', 'storage initialization failed', {
      error: error instanceof Error ? error.message : String(error)
    })
    process.exit(1)
  }

  if (getAppState().status === 'MIGRATION_FAILED') {
    process.exit(migrationFailureExitCode)
  }
  if (getAppState().status === 'DOWNGRADE_REJECTED') {
    process.exit(downgradeRejectionExitCode)
  }

  setStatus('READY', {})

  try {
    const summary = await resetStuckRunningTasks({ source: 'startup' })
    if (summary.resetCount > 0) {
      logger.warn('startup', `启动时重置 ${summary.resetCount} 个残留运行中任务`, {
        resetTaskIds: summary.resetTaskIds
      })
    }
  } catch (error) {
    logger.error('startup', '启动时清理残留运行状态失败', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
  startScheduler()
  logger.info('server', `PT Automation ready (schema v${getAppState().schemaVersion}, db v${getAppState().dbVersion})`)
})
