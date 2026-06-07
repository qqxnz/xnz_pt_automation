import { app } from './app.js'
import { logger } from './utils/logger.js'
import { startScheduler } from './utils/scheduler.js'

const port = Number(process.env.PORT ?? 3180)

app.listen(port, () => {
  startScheduler()
  logger.info('server', `PT Automation API listening on http://localhost:${port}`)
})
