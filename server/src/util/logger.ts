// 结构化单行日志，写 stdout 的同时落到 var/logs/server-<日期>.log。
import fs from 'node:fs'
import path from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly logsDir: string | null = null,
  ) {}

  private write(level: LogLevel, msg: string, extra?: unknown): void {
    const min = (process.env.MW_LOG_LEVEL as LogLevel | undefined) ?? 'info'
    if (LEVEL_WEIGHT[level] < (LEVEL_WEIGHT[min] ?? 20)) return
    const time = new Date().toISOString()
    const tail = extra === undefined ? '' : ' ' + safeJson(extra)
    const line = time + ' ' + level.toUpperCase().padEnd(5) + ' [' + this.scope + '] ' + msg + tail
    if (level === 'error') console.error(line)
    else console.log(line)
    if (this.logsDir) {
      try {
        fs.mkdirSync(this.logsDir, { recursive: true })
        fs.appendFileSync(path.join(this.logsDir, 'server-' + time.slice(0, 10) + '.log'), line + '\n', 'utf8')
      } catch {
        // 日志落盘失败不影响主流程
      }
    }
  }

  debug(msg: string, extra?: unknown): void {
    this.write('debug', msg, extra)
  }
  info(msg: string, extra?: unknown): void {
    this.write('info', msg, extra)
  }
  warn(msg: string, extra?: unknown): void {
    this.write('warn', msg, extra)
  }
  error(msg: string, extra?: unknown): void {
    this.write('error', msg, extra)
  }
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}