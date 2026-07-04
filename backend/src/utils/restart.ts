/**
 * runtime 检测与重启
 *
 * 用于"数据库恢复"流程：替换 db 文件后自动触发 PM2 / Docker 重新拉起进程。
 * 检测优先级：PM2 环境变量 > /.dockerenv > 不可识别。
 */

import { existsSync, readFileSync } from 'node:fs'
import { logger } from './logger.js'

export type RuntimeKind = 'pm2' | 'docker' | 'unknown'

export function detectRuntime(): RuntimeKind {
  if (process.env.PM2_HOME || process.env.PM2_USAGE || process.env.pm_exec_path) {
    return 'pm2'
  }
  if (existsSync('/.dockerenv')) {
    return 'docker'
  }
  try {
    const cgroup = readFileSync('/proc/1/cgroup', 'utf8')
    if (/docker|kubepods|containerd/i.test(cgroup)) {
      return 'docker'
    }
  } catch {
    // 非 linux 或无权限，跳过
  }
  return 'unknown'
}

export type TriggerRestartOptions = {
  reason?: string
  exitCode?: number
  delayMs?: number
}

export function triggerRestart(options: TriggerRestartOptions = {}): void {
  const runtime = detectRuntime()
  const reason = options.reason ?? 'manual-trigger'
  const exitCode = options.exitCode ?? 0
  const delayMs = options.delayMs ?? 0

  logger.warn('restart', '触发进程退出以重启', { runtime, reason, exitCode, delayMs })

  if (delayMs > 0) {
    setTimeout(() => process.exit(exitCode), delayMs)
    return
  }
  process.exit(exitCode)
}
