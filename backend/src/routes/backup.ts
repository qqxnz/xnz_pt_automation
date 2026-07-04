/**
 * 数据库备份路由
 *
 * 不维护任何索引：所有列表读取 dataDir/backup 目录下的 db-*.sqlite3 文件。
 * 用户可在文件管理器自由移动/移入文件，移动走文件后再访问对应端点将返回 404。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getMeta, setMeta } from '../storage/_meta.js'
import {
  createManualBackup,
  deleteBackup as deleteBackupFile,
  listBackups,
  nameLooksSafe,
  resolveBackupPath,
  type BackupItem
} from '../storage/backup.js'
import { getCurrentDatabase, restoreDatabaseFile, storagePaths } from '../storage.js'
import { logger, recordOperationLog } from '../utils/logger.js'
import { detectRuntime, triggerRestart } from '../utils/restart.js'

export const backupRouter = Router()

function notFound(res: { status: (code: number) => { json: (body: object) => void } }, message = '备份文件已被移走或删除') {
  res.status(404).json({ code: 'BACKUP_NOT_FOUND', message })
}

function invalidName(res: { status: (code: number) => { json: (body: object) => void } }, message = '备份文件名不合法') {
  res.status(400).json({ code: 'INVALID_BACKUP_NAME', message })
}

backupRouter.get('/', requireAuth, async (_req, res) => {
  const backups = listBackups(storagePaths.dataDir)
  const db = getCurrentDatabase()
  const lastBackupAt = getMeta(db, 'last_backup_at')
  res.json({
    backups,
    dataDir: storagePaths.dataDir,
    lastBackupAt
  })
})

backupRouter.post('/run', requireAuth, async (req, res) => {
  const db = getCurrentDatabase()
  let result: ReturnType<typeof createManualBackup>
  try {
    result = createManualBackup(db, storagePaths.dataDir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('backup', '立即备份失败', { error: message })
    await recordOperationLog({
      action: 'BACKUP_CREATE',
      message: `立即备份失败：${message}`,
      actorId: res.locals.user.id,
      actorName: res.locals.user.username,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      status: 'FAILED'
    })
    res.status(500).json({ code: 'BACKUP_CREATE_FAILED', message })
    return
  }

  const item: BackupItem = {
    name: path.basename(result.path),
    sizeBytes: result.sizeBytes,
    mtime: new Date().toISOString()
  }
  await recordOperationLog({
    action: 'BACKUP_CREATE',
    message: `生成手动备份：${item.name}（${item.sizeBytes} bytes）`,
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ backup: item })
})

backupRouter.get('/:name/download', requireAuth, (req, res) => {
  const name = req.params.name
  if (!nameLooksSafe(name)) {
    invalidName(res)
    return
  }
  let abs: string
  try {
    abs = resolveBackupPath(storagePaths.dataDir, name)
  } catch {
    invalidName(res)
    return
  }
  if (!existsSync(abs)) {
    notFound(res)
    return
  }
  res.download(abs, name)
})

backupRouter.delete('/:name', requireAuth, async (req, res) => {
  const name = req.params.name
  if (!nameLooksSafe(name)) {
    invalidName(res)
    return
  }
  try {
    deleteBackupFile(storagePaths.dataDir, name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'BACKUP_NOT_FOUND') {
      notFound(res)
      return
    }
    res.status(500).json({ code: 'BACKUP_DELETE_FAILED', message })
    return
  }
  await recordOperationLog({
    action: 'BACKUP_DELETE',
    message: `删除备份：${name}`,
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })
  res.json({ deleted: name })
})

backupRouter.post('/:name/restore', requireAuth, async (req, res) => {
  const name = req.params.name
  if (!nameLooksSafe(name)) {
    invalidName(res)
    return
  }
  let abs: string
  try {
    abs = resolveBackupPath(storagePaths.dataDir, name)
  } catch {
    invalidName(res)
    return
  }
  if (!existsSync(abs)) {
    notFound(res)
    return
  }

  let safetyBackup: BackupItem | undefined
  try {
    const db = getCurrentDatabase()
    const result = createManualBackup(db, storagePaths.dataDir)
    safetyBackup = {
      name: path.basename(result.path),
      sizeBytes: result.sizeBytes,
      mtime: new Date().toISOString()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('backup', '恢复前安全备份失败，已中止恢复', { error: message })
    await recordOperationLog({
      action: 'BACKUP_RESTORE',
      message: `恢复 ${name} 失败：恢复前安全备份出错 ${message}`,
      actorId: res.locals.user.id,
      actorName: res.locals.user.username,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      status: 'FAILED'
    })
    res.status(500).json({ code: 'BACKUP_RESTORE_FAILED', message: `恢复前安全备份失败：${message}` })
    return
  }

  try {
    await restoreDatabaseFile(abs)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('backup', 'restoreDatabaseFile 失败', { error: message })
    await recordOperationLog({
      action: 'BACKUP_RESTORE',
      message: `恢复 ${name} 失败：${message}`,
      actorId: res.locals.user.id,
      actorName: res.locals.user.username,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      status: 'FAILED'
    })
    res.status(500).json({ code: 'BACKUP_RESTORE_FAILED', message })
    return
  }

  try {
    const db = getCurrentDatabase()
    setMeta(db, 'last_restore_path', abs)
    setMeta(db, 'last_restore_at', new Date().toISOString())
    setMeta(db, 'restored_pending', '1')
  } catch {
    // 标记失败不影响主流程
  }

  await recordOperationLog({
    action: 'BACKUP_RESTORE',
    message: `从备份 ${name} 恢复成功（安全备份：${safetyBackup.name}）；即将重启 (${detectRuntime()})`,
    actorId: res.locals.user.id,
    actorName: res.locals.user.username,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    status: 'SUCCESS'
  })

  res.json({
    restartRequired: true,
    runtime: detectRuntime(),
    safetyBackup,
    message: '恢复成功，应用即将重启'
  })

  triggerRestart({ reason: `restore:${name}`, delayMs: 1500 })
})
