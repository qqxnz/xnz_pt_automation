import { app } from './app.js'
import { startTaskScheduler } from './routes/tasks.js'
import { logger } from './utils/logger.js'

const port = Number(process.env.PORT ?? 3180)

app.listen(port, () => {
  startTaskScheduler()
  logger.info('server', `PT Automation API listening on http://localhost:${port}`)
})
