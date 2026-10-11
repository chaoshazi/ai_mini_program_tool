// 工具自身的接口：统一 { code, message, data }；生成链路走 SSE。
import fs from 'node:fs'
import path from 'node:path'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AppConfig } from '../config.js'
import { createEmitter } from '../agent/events.js'
import { executeRun } from '../agent/loop.js'
import { toAppName } from '../agent/scaffold.js'
import type { Store } from '../store/db.js'
import type { Message, Project } from '../store/types.js'
import { ApiCode, ApiError } from '../util/errors.js'
import { newId, nowIso } from '../util/ids.js'
import { Logger } from '../util/logger.js'
import type { PreviewManager } from '../runtime/preview.js'
import { removeDirWithRetry, Workspace } from '../runtime/workspace.js'
import { assertSafeExportName, buildExport, exportFilename, exportsDir } from '../runtime/export.js'
import { normalizeApiOrigin } from './schemas.js'

export interface ApiDeps {
  config: AppConfig
  store: Store
  previews: PreviewManager
  logger: Logger
}

function ok<T>(reply: FastifyReply, data: T): void {
  reply.send({ code: ApiCode.OK, message: 'ok', data })
}

function body<T extends object>(raw: unknown): T {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw ApiError.badRequest('请求体必须是 JSON 对象')
  return raw as T
}

function pickName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.slice(0, 60) || fallback
}

export function registerApiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { config, store, previews, logger } = deps

  const requireProject = (id: string): Project => {
    const project = store.getProject(id)
    if (!project) throw ApiError.notFound('项目不存在：' + id)
    return project
  }

  app.get('/api/health', (_req, reply) => {
    ok(reply, {
      ok: true,
      name: 'miniwechat',
      schemaVersion: store.schemaVersion(),
      llm: { enabled: config.llm.enabled, model: config.llm.model, baseUrl: config.llm.baseUrl },
      previews: previews.list().length,
    })
  })

  app.get('/api/projects', (_req, reply) => {
    ok(reply, store.listProjects())
  })

  app.post('/api/projects', (req, reply) => {
    const input = body<{ name?: string; description?: string }>(req.body ?? {})
    const name = pickName(input.name, '未命名项目')
    const project: Project = {
      id: newId('prj'),
      name,
      description: typeof input.description === 'string' ? input.description.trim().slice(0, 300) : '',
      status: 'draft',
      mode: config.llm.enabled ? 'llm' : 'offline',
      previewStatus: 'stopped',
      previewUrl: null,
      apiOrigin: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    Workspace.ensure(config.workspacesDir, project.id)
    store.createProject(project)
    store.replaceFileIndex(project.id, [])
    logger.info('新建项目 ' + project.id + '（' + name + '）')
    reply.code(201)
    ok(reply, project)
  })

  app.get('/api/projects/:id', (req, reply) => {
    const id = (req.params as { id: string }).id
    const project = requireProject(id)
    ok(reply, { ...project, preview: previews.info(id) })
  })

  app.patch('/api/projects/:id', (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    const input = body<{ name?: string; description?: string; apiOrigin?: unknown }>(req.body ?? {})
    const patch: Partial<Project> = {}
    if (input.name !== undefined) patch.name = pickName(input.name, '未命名项目')
    if (input.description !== undefined) patch.description = String(input.description).trim().slice(0, 300)
    if (input.apiOrigin !== undefined) {
      const normalized = normalizeApiOrigin(input.apiOrigin)
      if (!normalized.ok) throw ApiError.badRequest(normalized.message)
      patch.apiOrigin = normalized.value
    }
    ok(reply, store.updateProject(id, patch))
  })

  app.delete('/api/projects/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    // 先停预览再清目录：子进程刚退出时 Windows 可能还占着句柄，所以清理带重试且失败不阻塞删除。
    await previews.stop(id)
    const workspace = Workspace.ensure(config.workspacesDir, id)
    const cleaned = await removeDirWithRetry(workspace.root)
    store.deleteProject(id)
    if (!cleaned) {
      logger.warn('项目 ' + id + ' 的工作目录仍被占用，未清理干净：' + workspace.root)
    }
    logger.info('已删除项目 ' + id + (cleaned ? '' : '（工作目录残留）'))
    reply.code(200)
    ok(reply, { id, workspaceCleaned: cleaned })
  })

  app.get('/api/projects/:id/files', async (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    const workspace = Workspace.ensure(config.workspacesDir, id)
    ok(reply, await workspace.listFiles(2000))
  })

  app.get('/api/projects/:id/files/*', async (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    const rel = (req.params as Record<string, string>)['*'] ?? ''
    const workspace = Workspace.ensure(config.workspacesDir, id)
    const content = await workspace.readFile(rel)
    ok(reply, { path: rel, content })
  })

  app.get('/api/projects/:id/messages', (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    ok(reply, store.listMessages(id))
  })

  app.get('/api/projects/:id/runs', (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    ok(reply, store.listRuns(id))
  })

  app.post('/api/projects/:id/messages', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const project = requireProject(id)
    const input = body<{ content?: string }>(req.body ?? {})
    const content = typeof input.content === 'string' ? input.content.trim() : ''
    if (!content) throw ApiError.badRequest('content 不能为空')
    if (content.length > 4000) throw ApiError.badRequest('单条需求不要超过 4000 字')

    const runId = newId('run')
    const userMessage: Message = {
      id: newId('msg'),
      projectId: id,
      role: 'user',
      content,
      runId,
      createdAt: nowIso(),
    }
    store.addMessage(userMessage)
    store.createRun({
      id: runId,
      projectId: id,
      status: 'running',
      mode: project.mode,
      summary: '',
      files: [],
      build: null,
      error: null,
      startedAt: nowIso(),
      finishedAt: null,
    })
    store.updateProject(id, { status: 'generating' })

    reply.hijack()
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })

    const write = (chunk: string): void => {
      if (!reply.raw.writableEnded) reply.raw.write(chunk)
    }
    const emit = createEmitter(runId, (frame) => {
      write('event: ' + frame.event + '\n')
      write('data: ' + frame.data + '\n\n')
    })
    const ping = setInterval(() => write(': ping\n\n'), 15_000)
    const controller = new AbortController()
    reply.raw.on('close', () => controller.abort())

    const history = store
      .listMessages(id, 40)
      .filter((message) => message.role !== 'system')
      .slice(0, -1)
      .slice(-6)
      .map((message) => (message.role === 'user' ? '用户：' : '助手：') + message.content)

    try {
      const outcome = await executeRun({
        config,
        store,
        logger,
        previews,
        project,
        userMessage: content,
        history,
        runId,
        emit,
        signal: controller.signal,
      })
      store.addMessage({
        id: newId('msg'),
        projectId: id,
        role: 'assistant',
        content:
          outcome.status === 'succeeded'
            ? outcome.summary + (outcome.files.length > 0 ? '（改动 ' + outcome.files.length + ' 个文件）' : '')
            : '生成失败：' + (outcome.error ?? '未知错误'),
        runId,
        createdAt: nowIso(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('SSE 处理异常：' + message, { projectId: id })
      emit('error', { code: ApiCode.INTERNAL, message, detail: null })
      store.finishRun(runId, { status: 'failed', error: message })
      store.updateProject(id, { status: 'error' })
    } finally {
      clearInterval(ping)
      reply.raw.end()
    }
  })

  app.post('/api/projects/:id/export', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const project = requireProject(id)
    const workspace = Workspace.ensure(config.workspacesDir, id)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = exportFilename(toAppName(project.name), stamp)
    const result = await buildExport(workspace, filename)
    fs.writeFileSync(path.join(exportsDir(config.varDir), filename), result.buffer)
    logger.info('导出 ' + filename + '（' + result.entries + ' 个文件，' + result.bytes + 'B）')
    ok(reply, {
      filename,
      url: '/api/projects/' + id + '/export.zip?file=' + encodeURIComponent(filename),
      bytes: result.bytes,
      entries: result.entries,
    })
  })

  app.get('/api/projects/:id/export.zip', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const project = requireProject(id)
    const query = req.query as { file?: string }
    const dir = exportsDir(config.varDir)
    let filename = query.file ? assertSafeExportName(query.file) : ''
    let abs = filename ? path.join(dir, filename) : ''
    if (!abs || !fs.existsSync(abs)) {
      const workspace = Workspace.ensure(config.workspacesDir, id)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      filename = exportFilename(toAppName(project.name), stamp)
      const result = await buildExport(workspace, filename)
      abs = path.join(dir, filename)
      fs.writeFileSync(abs, result.buffer)
    }
    // 用 Buffer 而不是流：zip 体积不大，且避免流式响应在代理/网关下丢 body。
    const payload = fs.readFileSync(abs)
    reply
      .header('content-type', 'application/zip')
      .header('content-length', String(payload.byteLength))
      .header('content-disposition', 'attachment; filename="' + filename + '"')
      .send(payload)
  })

  app.get('/api/projects/:id/preview', (req, reply) => {
    const id = (req.params as { id: string }).id
    const project = requireProject(id)
    ok(
      reply,
      previews.info(id) ?? {
        projectId: id,
        status: 'stopped',
        url: project.previewUrl ?? '',
        clientPort: 0,
        apiPort: 0,
        apiOrigin: project.apiOrigin,
        startedAt: nowIso(),
      },
    )
  })

  app.post('/api/projects/:id/preview', async (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    const input = body<{ action?: string }>(req.body ?? {})
    if (input.action === 'stop') {
      await previews.stop(id)
      ok(reply, previews.info(id) ?? { projectId: id, status: 'stopped', url: '', clientPort: 0, apiPort: 0, startedAt: nowIso() })
      return
    }
    ok(reply, await previews.start(id))
  })

  app.delete('/api/projects/:id/preview', async (req, reply) => {
    const id = (req.params as { id: string }).id
    requireProject(id)
    await previews.stop(id)
    ok(reply, { projectId: id, stopped: true })
  })
}