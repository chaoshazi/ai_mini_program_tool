// 预览编排：同一个项目起两个进程（client H5 dev server + 自带 Node 后端），
// 通过 /preview/<projectId>/ 路径前缀反向代理对外暴露，同一 origin 也顺带解决 CORS。
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { AppConfig } from '../config.js'
import type { Store } from '../store/db.js'
import { ApiCode, ApiError } from '../util/errors.js'
import { Logger } from '../util/logger.js'
import { Builder } from './build.js'
import { killTree, spawnTokens } from './command.js'
import { PortSlots } from './ports.js'
import { reclaimPreviewPorts } from './reclaim.js'
import { Workspace } from './workspace.js'

export interface PreviewInfo {
  projectId: string
  status: 'starting' | 'running' | 'error' | 'stopped'
  url: string
  clientPort: number
  apiPort: number
  /** 非空表示这个项目的 /api 走的是外部后端（例如自己的 PHP 接口），而不是生成工程自带的 Node 后端。 */
  apiOrigin: string | null
  startedAt: string
  error?: string
}

interface PreviewProcess extends PreviewInfo {
  slot: number
  client: ReturnType<typeof spawnTokens> | null
  api: ReturnType<typeof spawnTokens> | null
  logs: string[]
}

function previewBase(projectId: string): string {
  return '/preview/' + projectId + '/'
}

/**
 * 预览时写进 client/.env.local 的内容。
 * 不变量：前缀没有结尾斜杠、也不含 /api —— 页面里的调用统一写 '/api/xxx'，
 * 两边都带就会拼成 /api/api/xxx（这个坑由 tests/preview.test.ts 守着）。
 */
export function previewEnv(projectId: string): string {
  const raw = previewBase(projectId)
  const base = raw.endsWith('/') ? raw.slice(0, -1) : raw
  return ['VITE_API_BASE=' + base, 'MW_PREVIEW_BASE=' + raw, ''].join('\n')
}

/**
 * 预览只对"已经生成出工程"的项目开放。工作区为空（新建后还没生成、或 var/ 被清过）时给出
 * 可执行的提示，而不是让 fs 抛 ENOENT 之后变成一个看不懂的 500。
 */
export function assertGeneratedProject(workspace: Workspace, options: { requireApi?: boolean } = {}): void {
  const required = options.requireApi === false ? ['client/package.json'] : ['client/package.json', 'server/package.json']
  const missing = required.filter(
    (rel) => !fs.existsSync(path.join(workspace.root, ...rel.split('/'))),
  )
  if (missing.length === 0) return
  throw ApiError.badRequest(
    '这个项目还没有生成工程文件（缺少 ' + missing.join('、') + '）：先发一条需求让 AI 生成 client/ 与 server/，再启动预览',
    { missing },
  )
}

export class PreviewManager {
  private readonly previews = new Map<string, PreviewProcess>()
  private readonly slots: PortSlots

  constructor(
    private readonly config: AppConfig,
    private readonly store: Store,
    private readonly logger: Logger,
  ) {
    this.slots = new PortSlots(config.previewPortBase, config.previewConcurrency)
  }

  list(): PreviewInfo[] {
    return Array.from(this.previews.values()).map((entry) => this.public(entry))
  }

  info(projectId: string): PreviewInfo | null {
    const entry = this.previews.get(projectId)
    return entry ? this.public(entry) : null
  }

  /** 代理用：拿到该项目的两个上游 origin。 */
  targets(projectId: string): { clientOrigin: string; apiOrigin: string } | null {
    const entry = this.previews.get(projectId)
    if (!entry || entry.status !== 'running') return null
    return {
      clientOrigin: 'http://127.0.0.1:' + entry.clientPort,
      apiOrigin: entry.apiOrigin ?? 'http://127.0.0.1:' + entry.apiPort,
    }
  }

  private public(entry: PreviewProcess): PreviewInfo {
    const info: PreviewInfo = {
      projectId: entry.projectId,
      status: entry.status,
      url: entry.url,
      clientPort: entry.clientPort,
      apiPort: entry.apiPort,
      apiOrigin: entry.apiOrigin,
      startedAt: entry.startedAt,
    }
    if (entry.error) info.error = entry.error
    return info
  }

  async start(projectId: string): Promise<PreviewInfo> {
    const existing = this.previews.get(projectId)
    if (existing && existing.status === 'running') return this.public(existing)
    if (existing) await this.stop(projectId)

    const project = this.store.getProject(projectId)
    if (!project) throw ApiError.notFound('项目不存在：' + projectId)
    // 项目指定了外部后端（例如自己的 PHP 接口）时，只需要页面工程存在，不再要求生成工程自带后端
    const apiOrigin = project.apiOrigin
    const workspace = Workspace.ensure(this.config.workspacesDir, projectId)
    assertGeneratedProject(workspace, { requireApi: apiOrigin === null })

    const slot = this.slots.allocate()
    if (!slot) throw new ApiError(50003, '预览并发已满（' + this.config.previewConcurrency + ' 个），请先停止其它项目预览', 429)

    try {
      await this.ensurePortsFree([slot.clientPort, slot.apiPort])
    } catch (error) {
      this.slots.release(slot.slot)
      throw error
    }

    const base = previewBase(projectId)
    const entry: PreviewProcess = {
      projectId,
      slot: slot.slot,
      clientPort: slot.clientPort,
      apiPort: slot.apiPort,
      apiOrigin,
      status: 'starting',
      url: base,
      startedAt: new Date().toISOString(),
      client: null,
      api: null,
      logs: [],
    }
    this.previews.set(projectId, entry)
    this.store.updateProject(projectId, { previewStatus: 'starting', previewUrl: base })

    try {
      const builder = new Builder({ config: this.config, workspace, logger: this.logger })
      const deps = await builder.ensureDeps()
      if (!deps.ok) throw new ApiError(50003, '预览前安装依赖失败：' + deps.output.split('\n').slice(-5).join(' '), 500)

      // 预览注入：同源 base + 相对 API 前缀，避免 CORS 与硬编码端口。
      fs.mkdirSync(path.join(workspace.root, 'client'), { recursive: true })
      fs.writeFileSync(
        path.join(workspace.root, 'client', '.env.local'),
        previewEnv(projectId),
        'utf8',
      )

      entry.client = spawnTokens(['npm', 'run', 'dev:h5'], {
        cwd: path.join(workspace.root, 'client'),
        timeoutMs: 12 * 60 * 60 * 1000,
        outputLimit: 4000,
        env: { MW_CLIENT_PORT: String(entry.clientPort), MW_PREVIEW_BASE: base },
      })
      this.collect(entry, entry.client, 'client')

      if (entry.apiOrigin) {
        // 自己的后端：不起生成工程自带的 Node 服务，直接把 /preview/<id>/api/... 反代过去
        this.logger.info('预览使用外部后端', { projectId, apiOrigin: entry.apiOrigin })
        await this.waitForExternalApi(entry.apiOrigin)
      } else {
        entry.api = spawnTokens(['npm', 'run', 'dev'], {
          cwd: path.join(workspace.root, 'server'),
          timeoutMs: 12 * 60 * 60 * 1000,
          outputLimit: 4000,
          env: { MW_API_PORT: String(entry.apiPort) },
        })
        this.collect(entry, entry.api, 'api')
        await this.waitFor('http://127.0.0.1:' + entry.apiPort + '/api/health', 60_000, '后端接口')
      }

      await this.waitFor('http://127.0.0.1:' + entry.clientPort + base, 120_000, '前端 H5')

      entry.status = 'running'
      this.store.updateProject(projectId, { previewStatus: 'running', previewUrl: base })
      this.logger.info('预览已就绪', { projectId, url: base, clientPort: entry.clientPort, apiPort: entry.apiPort })
      return this.public(entry)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entry.status = 'error'
      entry.error = message
      this.store.updateProject(projectId, { previewStatus: 'error' })
      await this.stop(projectId)
      this.logger.error('预览启动失败：' + message, { projectId, logs: entry.logs.slice(-8) })
      throw error instanceof ApiError ? error : new ApiError(50003, '预览启动失败：' + message, 500)
    }
  }

  async stop(projectId: string): Promise<boolean> {
    const entry = this.previews.get(projectId)
    if (!entry) {
      this.store.updateProject(projectId, { previewStatus: 'stopped', previewUrl: null })
      return false
    }
    for (const handle of [entry.client, entry.api]) {
      if (handle?.child.pid) killTree(handle.child)
    }
    this.slots.release(entry.slot)
    this.previews.delete(projectId)
    const envFile = path.join(this.config.workspacesDir, projectId, 'client', '.env.local')
    if (fs.existsSync(envFile)) fs.rmSync(envFile, { force: true })
    this.store.updateProject(projectId, { previewStatus: 'stopped', previewUrl: null })
    this.logger.info('预览已停止', { projectId })
    return true
  }

  /** 生成完一轮后让预览重新加载（预览关掉了 HMR，靠重启 client 进程刷新页面）。 */
  async refresh(projectId: string): Promise<void> {
    const entry = this.previews.get(projectId)
    if (!entry || entry.status !== 'running') return
    await this.stop(projectId)
    await this.start(projectId).catch((error: unknown) => {
      this.logger.warn('预览刷新失败：' + (error instanceof Error ? error.message : String(error)), { projectId })
    })
  }

  async stopAll(): Promise<void> {
    for (const projectId of Array.from(this.previews.keys())) {
      await this.stop(projectId)
    }
  }

  private collect(entry: PreviewProcess, handle: ReturnType<typeof spawnTokens>, tag: string): void {
    handle.done.then((result) => {
      if (result.ok || entry.status === 'starting') return
      entry.logs.push('[' + tag + '] ' + (result.stderr || result.stdout).split('\n').slice(-3).join(' '))
    })
    handle.child.stderr?.on('data', (chunk: Buffer) => {
      entry.logs.push('[' + tag + '] ' + chunk.toString('utf8').trim())
      if (entry.logs.length > 40) entry.logs.shift()
    })
    handle.child.stdout?.on('data', (chunk: Buffer) => {
      entry.logs.push('[' + tag + '] ' + chunk.toString('utf8').trim())
      if (entry.logs.length > 40) entry.logs.shift()
    })
    handle.child.on('exit', (code) => {
      if (entry.status === 'running' && code !== 0 && code !== null) {
        entry.status = 'error'
        entry.error = tag + ' 进程退出（code=' + code + '）'
        this.store.updateProject(entry.projectId, { previewStatus: 'error' })
      }
    })
  }

  /** 外部后端只看能不能连上：先探 /api/health，没有再退回根路径（两个都不通才算失败）。 */
  private async waitForExternalApi(origin: string): Promise<void> {
    const root = origin.replace(/\/+$/, '')
    const probes = [root + '/api/health', root + '/']
    const deadline = Date.now() + 20_000
    let lastError = '未知错误'
    while (Date.now() < deadline) {
      for (const url of probes) {
        try {
          const status = await headStatus(url)
          if (status > 0 && status < 500) return
          lastError = 'HTTP ' + status
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new ApiError(ApiCode.PREVIEW_FAILED, '外部后端 ' + origin + ' 连不上：' + lastError, 502)
  }

  /** 分配到的两个端口必须是空的：先回收上一轮残留的 node 子进程（工具重启会留下孤儿），其它占用直接报错。 */
  private async ensurePortsFree(ports: number[]): Promise<void> {
    const results = await reclaimPreviewPorts(ports, this.logger)
    const blocked = results.filter((item) => !item.killed)
    if (blocked.length === 0) return
    throw new ApiError(
      ApiCode.PREVIEW_FAILED,
      '预览端口被其它程序占用：' +
        blocked.map((item) => item.port + '（pid ' + item.pid + ' ' + item.name + '）').join('、') +
        '，先释放端口再启动预览',
      409,
    )
  }

  private async waitFor(url: string, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastError = ''
    while (Date.now() < deadline) {
      try {
        const status = await headStatus(url)
        if (status >= 200 && status < 500) return
        lastError = 'HTTP ' + status
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    throw new ApiError(50003, label + '在 ' + Math.round(timeoutMs / 1000) + 's 内未就绪（' + lastError + '）', 500)
  }
}

function headStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', timeout: 3000 }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('timeout', () => {
      req.destroy(new Error('请求超时'))
    })
    req.on('error', reject)
    req.end()
  })
}