import { app } from './app.js'
import { logger } from './utils/logger.js'
import { resetStuckRunningTasks } from './routes/tasks.js'
import { startScheduler } from './utils/scheduler.js'

const port = Number(process.env.PORT ?? 3180)

app.listen(port, async () => {
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
  logger.info('server', `PT Automation API listening on http://localhost:${port}`)
})
