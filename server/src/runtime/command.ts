// 生成代码的执行边界：工作目录内、命令白名单（npm / node / npx）、超时、输出截断、进程树回收。
import { spawn, type ChildProcess } from 'node:child_process'
import { ApiError } from '../util/errors.js'

export const ALLOWED_COMMANDS = ['npm', 'node', 'npx'] as const

/** shell: true 下必须排除的元字符（含 Windows cmd 的转义/展开符），否则可能拼接出额外命令。 */
const SHELL_META = /[&|;<>^`$!%(){}[\]*?\n\r"'\\]/

export interface CommandResult {
  command: string
  args: string[]
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface CommandOptions {
  cwd: string
  timeoutMs: number
  outputLimit: number
  env?: Record<string, string>
}

/** 简单分词：支持单/双引号包裹，引号内保留空格。 */
export function tokenize(command: string): string[] {
  const text = String(command ?? '').trim()
  if (!text) throw ApiError.badRequest('命令为空')
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (quote) throw ApiError.badRequest('命令里的引号没有闭合')
  if (current) tokens.push(current)
  return tokens
}

function baseName(token: string): string {
  return token.replace(/\\/g, '/').split('/').pop() ?? token
}

/** 白名单校验：命令名必须是 npm/node/npx，且任何参数都不得含 shell 元字符。 */
export function assertAllowed(tokens: string[]): void {
  const head = tokens[0]
  if (!head) throw ApiError.badRequest('命令为空')
  const name = baseName(head).replace(/\.(cmd|exe|bat)$/i, '')
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(name)) {
    throw ApiError.commandRejected('命令 ' + head + ' 不在白名单内，仅允许 ' + ALLOWED_COMMANDS.join(' / '))
  }
  if (baseName(head) !== head) {
    throw ApiError.commandRejected('命令名不能带路径：' + head)
  }
  for (const token of tokens.slice(1)) {
    if (SHELL_META.test(token)) {
      throw ApiError.commandRejected('参数含 shell 元字符，已拒绝：' + token)
    }
  }
}

function quoteArg(arg: string): string {
  return /[\s]/.test(arg) ? '"' + arg.replace(/"/g, '') + '"' : arg
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = Math.floor(limit * 0.6)
  const tail = Math.floor(limit * 0.4)
  return text.slice(0, head) + '\n…[已截断 ' + (text.length - limit) + ' 字符]…\n' + text.slice(-tail)
}

/** 结束进程树：Windows 用 taskkill /T，POSIX 用进程组信号。 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export interface SpawnHandle {
  child: ChildProcess
  done: Promise<CommandResult>
}

/** 底层执行：不做白名单校验（供内部可信流程使用），但仍限制 cwd 与超时。 */
export function spawnTokens(tokens: string[], options: CommandOptions): SpawnHandle {
  const [file, ...args] = tokens
  if (!file) throw ApiError.badRequest('命令为空')
  const started = Date.now()
  const resolved = process.platform === 'win32' && /^(npm|npx)$/i.test(file) ? file + '.cmd' : file
  const child = spawn(resolved, args, {
    cwd: options.cwd,
    shell: process.platform === 'win32',
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, ...options.env, NO_COLOR: '1', CI: '' },
  })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let settled = false
  const done = new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, options.timeoutMs)
    const finish = (exitCode: number | null, spawnError?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (spawnError) stderr += (stderr ? '\n' : '') + spawnError.message
      resolve({
        command: tokens.join(' '),
        args,
        ok: exitCode === 0 && !spawnError && !timedOut,
        exitCode,
        stdout: truncate(stdout, options.outputLimit),
        stderr: truncate(stderr, options.outputLimit),
        durationMs: Date.now() - started,
        timedOut,
      })
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error: Error) => finish(null, error))
    child.on('close', (code) => finish(code))
  })
  return { child, done }
}

/** 对外（模型工具）使用的执行入口：先白名单校验再执行。 */
export async function runCommand(command: string, options: CommandOptions): Promise<CommandResult> {
  const tokens = tokenize(command)
  assertAllowed(tokens)
  return spawnTokens(tokens, options).done
}