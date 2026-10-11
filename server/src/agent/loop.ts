// 一轮生成的编排：plan → 生成/修改 → 构建校验（失败回灌重试）→ 预览就绪 → done。
import type { AppConfig } from '../config.js'
import type { Store } from '../store/db.js'
import type { BuildReport, FileChange, GenerationMode, Project } from '../store/types.js'
import { ApiCode, ApiError } from '../util/errors.js'
import { Logger } from '../util/logger.js'
import { Builder } from '../runtime/build.js'
import type { PreviewManager } from '../runtime/preview.js'
import { Workspace } from '../runtime/workspace.js'
import { renderProject } from '../templates/index.js'
import { diffIndex } from './diff.js'
import type { Emitter } from './events.js'
import { LlmClient, parseToolArguments, type ChatMessage } from './llm.js'
import { buildFixPrompt, buildSystemPrompt, buildUserPrompt } from './prompts.js'
import { scaffoldWorkspace, toAppName } from './scaffold.js'
import { executeTool, TOOL_SCHEMAS, type ToolContext } from './tools.js'

/** 一轮里最多几次模型往返；修复轮单独给更小的预算。 */
const MAX_STEPS = 28
const MAX_FIX_STEPS = 12
const MAX_HISTORY = 3

export interface RunOptions {
  config: AppConfig
  store: Store
  logger: Logger
  previews: PreviewManager
  project: Project
  userMessage: string
  history: string[]
  runId: string
  emit: Emitter
  signal?: AbortSignal
}

export interface RunOutcome {
  status: 'succeeded' | 'failed'
  mode: GenerationMode
  summary: string
  files: FileChange[]
  build: BuildReport | null
  previewUrl: string | null
  error: string | null
}

export async function executeRun(options: RunOptions): Promise<RunOutcome> {
  const { config, store, logger, previews, project, emit, runId } = options
  const workspace = Workspace.ensure(config.workspacesDir, project.id)
  const mode: GenerationMode = config.llm.enabled ? 'llm' : 'offline'
  const builder = new Builder({ config, workspace, logger })
  const before = await workspace.snapshotIndex()
  const toolContext: ToolContext = {
    config,
    workspace,
    logger,
    emit,
    changes: [],
    state: { finished: false, summary: '', errors: [] },
  }

  let build: BuildReport | null = null
  let summary = ''
  let previewUrl: string | null = null
  const notes: string[] = []

  try {
    if (mode === 'offline') {
      const result = await scaffoldWorkspace(workspace, project, emit)
      summary = result.reason
      notes.push(result.reason)
    } else {
      const seeded = await seedTemplateIfEmpty(workspace, project, toolContext)
      emit('plan', {
        summary: seeded ? '已铺好工程骨架，接下来按需求生成代码' : '按需求增量修改现有工程',
        steps: [
          '理解需求并列出要改的文件',
          seeded ? '在模板骨架上改页面与接口' : '读取现有文件后打补丁',
          '本工程内自检 typecheck / 构建',
          '构建校验与预览刷新',
        ],
        mode,
      })
      const llm = new LlmClient(config.llm, logger)
      const messages: ChatMessage[] = [
        { role: 'system', content: buildSystemPrompt(promptContext(project, await fileTree(workspace), seeded)) },
        { role: 'user', content: buildUserPrompt(options.userMessage, options.history.slice(-MAX_HISTORY)) },
      ]
      const first = await agentLoop(llm, messages, toolContext, MAX_STEPS, options)
      notes.push(first || '模型未给出文字说明')

      // 构建校验 + 失败回灌重试
      for (let attempt = 0; attempt <= config.maxBuildRetries; attempt += 1) {
        const deps = await builder.ensureDeps()
        build = await builder.verify(attempt, deps.installed)
        emitBuild(emit, build)
        if (build.ok) break
        if (attempt === config.maxBuildRetries) {
          throw new ApiError(ApiCode.BUILD_FAILED, '构建校验连续失败 ' + (attempt + 1) + ' 次，产物已保留', 500, {
            errors: build.checks.filter((check) => !check.ok).map((check) => check.errors),
          })
        }
        toolContext.state.finished = false
        messages.push({ role: 'user', content: buildFixPrompt(build) })
        const fixNote = await agentLoop(llm, messages, toolContext, MAX_FIX_STEPS, options)
        if (fixNote) notes.push('修复轮：' + fixNote)
      }
    }

    if (mode === 'offline') {
      const deps = await builder.ensureDeps()
      if (!deps.ok) {
        throw new ApiError(ApiCode.BUILD_FAILED, '依赖安装失败：' + deps.output.split('\n').slice(-5).join(' '), 500)
      }
      build = await builder.verify(0, deps.installed)
      emitBuild(emit, build)
      if (!build.ok) {
        throw new ApiError(ApiCode.BUILD_FAILED, '离线脚手架产物的构建校验失败', 500, {
          errors: build.checks.filter((check) => !check.ok).map((check) => check.errors),
        })
      }
    }

    // 预览：已运行则刷新，未运行则尝试拉起（失败不阻塞本轮成功）
    try {
      const current = previews.info(project.id)
      if (current && current.status === 'running') {
        emit('preview', { status: 'starting', url: current.url, message: '代码已更新，正在重启预览进程' })
        await previews.refresh(project.id)
        const refreshed = previews.info(project.id)
        previewUrl = refreshed?.url ?? current.url
        emit('preview', { status: refreshed?.status === 'running' ? 'running' : 'error', url: previewUrl, message: '预览已刷新' })
      } else {
        emit('preview', { status: 'starting', url: null, message: '正在启动预览进程（首次会装依赖，可能要一两分钟）' })
        const info = await previews.start(project.id)
        previewUrl = info.url
        emit('preview', { status: 'running', url: info.url, message: '预览已就绪' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('预览未就绪：' + message, { projectId: project.id })
      emit('preview', { status: 'error', url: null, message })
      notes.push('预览未就绪：' + message)
    }

    const after = await workspace.snapshotIndex()
    const files = toolContext.changes.length > 0 ? toolContext.changes : diffIndex(before, after)
    store.replaceFileIndex(project.id, after)
    summary = toolContext.state.summary || summary || notes[0] || '本轮未产生文件改动'
    store.finishRun(runId, { status: 'succeeded', summary, files, build, error: null })
    store.updateProject(project.id, { status: 'ready', mode })
    emit('done', { runId, mode, summary, files, build, previewUrl })
    return { status: 'succeeded', mode, summary, files, build, previewUrl, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof ApiError ? error.code : ApiCode.INTERNAL
    const detail = error instanceof ApiError ? error.detail : null
    const after = await workspace.snapshotIndex().catch(() => [])
    if (after.length > 0) store.replaceFileIndex(project.id, after)
    store.finishRun(runId, {
      status: 'failed',
      summary,
      files: toolContext.changes,
      build,
      error: message,
    })
    store.updateProject(project.id, { status: 'error', mode })
    logger.error('生成失败：' + message, { projectId: project.id, runId })
    emit('error', { code, message, detail })
    return {
      status: 'failed',
      mode,
      summary,
      files: toolContext.changes,
      build,
      previewUrl,
      error: message,
    }
  }
}

/** 新工程先渲染模板骨架，保证模型是从一个能跑通的基线开始改。 */
async function seedTemplateIfEmpty(workspace: Workspace, project: Project, ctx: ToolContext): Promise<boolean> {
  const existing = await workspace.listFiles(20)
  if (existing.some((file) => file.path === 'package.json')) return false
  const changes = await renderProject(workspace, {
    appName: toAppName(project.name),
    appTitle: project.name,
    description: project.description || '由 miniwechat 生成的 uni-app + Node 工程',
  })
  for (const change of changes) {
    ctx.emit('file', { path: change.path, action: change.action, bytes: change.bytes })
    ctx.changes.push(change)
  }
  return true
}

async function fileTree(workspace: Workspace): Promise<string[]> {
  const files = await workspace.listFiles(200)
  return files.map((file) => file.path)
}

function promptContext(project: Project, tree: string[], seeded: boolean): {
  projectName: string
  projectDescription: string
  fileTree: string[]
  seeded: boolean
} {
  return { projectName: project.name, projectDescription: project.description, fileTree: tree, seeded }
}

/** 反复「模型 → 工具」直到 finish、模型不再调用工具或步数用尽。 */
async function agentLoop(
  llm: LlmClient,
  messages: ChatMessage[],
  toolContext: ToolContext,
  maxSteps: number,
  options: RunOptions,
): Promise<string> {
  let note = ''
  for (let step = 0; step < maxSteps; step += 1) {
    const result = await llm.chat({
      messages,
      tools: TOOL_SCHEMAS,
      onDelta: (text) => options.emit('delta', { text }),
      signal: options.signal,
    })
    if (result.content.trim()) note = result.content.trim()
    messages.push({
      role: 'assistant',
      content: result.content || null,
      ...(result.toolCalls.length > 0 ? { tool_calls: result.toolCalls } : {}),
    })
    if (result.toolCalls.length === 0) break
    for (const call of result.toolCalls) {
      let text: string
      try {
        const args = parseToolArguments(call.function.arguments, call.function.name)
        const outcome = await executeTool(call.function.name, args, toolContext)
        text = outcome.text
      } catch (error) {
        // 工具报错也要回灌给模型，让它自己纠正（路径越界/命令被拒/补丁匹配失败）。
        const message = error instanceof Error ? error.message : String(error)
        text = '工具执行失败：' + message
        toolContext.state.errors.push(message)
        options.emit('tool', { name: call.function.name, ok: false, detail: message, args: {} })
        options.logger.warn('工具 ' + call.function.name + ' 执行失败：' + message, { projectId: options.project.id })
      }
      messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: text })
      if (toolContext.state.finished) break
    }
    if (toolContext.state.finished) break
  }
  return note
}

function emitBuild(emit: Emitter, report: BuildReport): void {
  emit('build', {
    ok: report.ok,
    attempt: report.attempt,
    installed: report.installed,
    checks: report.checks.map((check) => ({
      name: check.name,
      ok: check.ok,
      durationMs: check.durationMs,
      errors: check.errors,
    })),
  })
}
