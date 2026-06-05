import { app } from './app.js'
import { startSiteTrafficScheduler } from './routes/sites.js'
import { startTaskScheduler } from './routes/tasks.js'
import { logger } from './utils/logger.js'
import { startTorrentDownloadStatsScheduler } from './utils/torrentSync.js'

const port = Number(process.env.PORT ?? 3180)

app.listen(port, () => {
  startTaskScheduler()
  startTorrentDownloadStatsScheduler()
  startSiteTrafficScheduler()
  logger.info('server', `PT Automation API listening on http://localhost:${port}`)
})
