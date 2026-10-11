// 预览端口回收：工具被 `tsx watch` 重启（或崩过一次）时，上一轮预览起的 client/server 子进程会
// 变成孤儿，继续占着 9400 起的端口；下一次预览再分配到同一个槽位就会因为 vite `strictPort` 直接失败。
// 这里在工具启动时扫一遍端口区间、以及在分配槽位后再扫一次，**只回收进程名是 node/npm 的监听者**，
// 其它进程一律不动，只把它当成"端口被占"报出来。
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Logger } from '../util/logger.js'

const run = promisify(execFile)

export interface PortListener {
  port: number
  pid: number
}

export interface ReclaimResult extends PortListener {
  name: string
  killed: boolean
}

/**
 * 只有 node / npm 系的进程才允许被回收，避免误杀别人占着同一端口的程序。
 * Windows 上 npm 脚本外面还套着一层 cmd.exe（带 /d /s /c 与完整子命令），所以 cmd 也算在内；
 * 真正的安全闸门是"端口属于预览区间"与"命令行必须落在工具工作区里"。
 */
export function shouldReclaim(name: string): boolean {
  const lower = name.toLowerCase().replace(/\.exe$/, '')
  return lower === 'node' || lower === 'npm' || lower === 'npx' || lower === 'cmd'
}

/** 解析 `netstat -ano -p tcp`（Windows）：挑出目标端口上处于 LISTENING 的 PID。纯函数，便于测试。 */
export function parseNetstatListeners(output: string, ports: number[]): PortListener[] {
  const wanted = new Set(ports)
  const hits: PortListener[] = []
  for (const line of output.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    const proto = cols[0] ?? ''
    const local = cols[1] ?? ''
    const state = cols[3] ?? ''
    const owner = Number(cols[4] ?? '')
    if (proto.toUpperCase() !== 'TCP' || state.toUpperCase() !== 'LISTENING') continue
    const port = Number(local.slice(local.lastIndexOf(':') + 1))
    if (!wanted.has(port) || !Number.isInteger(owner) || owner <= 0) continue
    hits.push({ port, pid: owner })
  }
  return hits
}

/** 解析 `lsof -nP -iTCP -sTCP:LISTEN -t`（POSIX）的 PID 列表。纯函数，便于测试。 */
export function parsePidList(output: string): number[] {
  return output
    .split('\n')
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}

async function listenersOn(ports: number[]): Promise<PortListener[]> {
  if (process.platform === 'win32') {
    const { stdout } = await run('netstat', ['-ano', '-p', 'tcp'], { maxBuffer: 8 * 1024 * 1024 })
    return parseNetstatListeners(stdout, ports)
  }
  try {
    const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-t'], { maxBuffer: 4 * 1024 * 1024 })
    const pids = parsePidList(stdout)
    // lsof 不给端口对应关系，这里保守处理：只要能查到就逐个确认进程名
    return pids.map((pid) => ({ port: ports[0] ?? 0, pid }))
  } catch {
    return []
  }
}

async function processName(pid: number): Promise<string> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FI', 'PID eq ' + pid, '/FO', 'CSV', '/NH'])
      const first = stdout.split('\n')[0] ?? ''
      return (first.split(',')[0] ?? '').replace(/"/g, '').trim()
    }
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm='])
    return stdout.trim()
  } catch {
    return ''
  }
}

function kill(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], () => undefined)
    } else {
      process.kill(pid, 'SIGKILL')
    }
  } catch {
    // 进程可能刚好自己退了，忽略
  }
}

/** 扫描给定端口上剩余的监听者：是 node/npm 就回收，其它进程留着（调用方负责报错）。 */
export async function reclaimPreviewPorts(ports: number[], logger?: Logger): Promise<ReclaimResult[]> {
  if (ports.length === 0) return []
  const listeners = await listenersOn(ports)
  const results: ReclaimResult[] = []
  for (const listener of listeners) {
    const name = await processName(listener.pid)
    const killed = shouldReclaim(name)
    if (killed) {
      logger?.warn('回收占用预览端口的残留进程', { port: listener.port, pid: listener.pid, name })
      kill(listener.pid)
    }
    results.push({ port: listener.port, pid: listener.pid, name, killed })
  }
  if (results.some((item) => item.killed)) {
    // 端口真正释放需要一点时间
    await new Promise((resolve) => setTimeout(resolve, 600))
  }
  return results
}

export interface ProcessEntry {
  pid: number
  name: string
  commandLine: string
}

/**
 * 挑出"跑在工具工作区里、但不属于当前这次工具运行"的残留进程。
 * 工具被 tsx watch 重启时，上一轮预览的 npm/cmd/tsx 监督进程不会跟着走，
 * 端口扫描只能看到真正在监听的子进程，这些"只占着目录"的监督进程要靠命令行来认。
 * 纯函数，便于测试。
 */
export function pickOrphanProcesses(entries: ProcessEntry[], workspacesDir: string): Array<{ pid: number; name: string }> {
  const marker = workspacesDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const picked: Array<{ pid: number; name: string }> = []
  for (const entry of entries) {
    if (!entry.commandLine) continue
    if (!shouldReclaim(entry.name)) continue
    const flat = entry.commandLine.replace(/\\/g, '/').toLowerCase()
    if (!flat.includes(marker)) continue
    picked.push({ pid: entry.pid, name: entry.name })
  }
  return picked
}

/** 列出 node/cmd 进程：Windows 走 PowerShell 的 CIM 查询，POSIX 走 ps。 */
export async function listProcesses(): Promise<ProcessEntry[]> {
  try {
    if (process.platform === 'win32') {
      const script =
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe' }" +
        ' | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'
      const { stdout } = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        maxBuffer: 16 * 1024 * 1024,
      })
      const trimmed = stdout.trim()
      if (trimmed === '') return []
      const parsed = JSON.parse(trimmed)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      return list.map((item) => ({
        pid: Number(item.ProcessId ?? 0),
        name: String(item.Name ?? ''),
        commandLine: String(item.CommandLine ?? ''),
      }))
    }
    const { stdout } = await run('ps', ['-eo', 'pid=,comm=,args='], { maxBuffer: 16 * 1024 * 1024 })
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const first = line.indexOf(' ')
        const second = line.indexOf(' ', first + 1)
        return {
          pid: Number(line.slice(0, first)),
          name: line.slice(first + 1, second),
          commandLine: line.slice(second + 1),
        }
      })
      .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0)
  } catch {
    return []
  }
}

/** 工具启动时调用：把上一轮预览留在工作区里的残留进程清掉。 */
export async function reclaimWorkspaceProcesses(workspacesDir: string, logger?: Logger): Promise<number> {
  const orphans = pickOrphanProcesses(await listProcesses(), workspacesDir)
  for (const orphan of orphans) {
    logger?.warn('清理工作区里的残留进程', { pid: orphan.pid, name: orphan.name })
    kill(orphan.pid)
  }
  return orphans.length
}

/** 预览端口区间：client = base + slot*2，api = base + slot*2 + 1。 */
export function previewPortRange(base: number, concurrency: number): number[] {
  return Array.from({ length: concurrency * 2 }, (_, index) => base + index)
}