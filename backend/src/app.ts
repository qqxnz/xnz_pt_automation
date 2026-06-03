import cookieParser from 'cookie-parser'
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { authRouter } from './routes/auth.js'
import { logsRouter } from './routes/logs.js'
import { statsRouter } from './routes/stats.js'
import { requestLogger } from './utils/logger.js'

export const app = express()

app.use(express.json())
app.use(cookieParser())
app.use(requestLogger)

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/auth', authRouter)
app.use('/api/stats', statsRouter)
app.use('/api/logs', logsRouter)

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const frontendDist = path.resolve(backendDir, '..', 'frontend', 'dist')

if (existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}
