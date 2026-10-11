// 生成链路的工具集：全部限定在项目工作目录内，路径越界与白名单外命令直接拒绝。
import type { AppConfig } from '../config.js'
import type { FileChange } from '../store/types.js'
import { ApiError } from '../util/errors.js'
import { Logger } from '../util/logger.js'
import { runCommand } from '../runtime/command.js'
import { applyBlock, parsePatch } from '../runtime/patch.js'
import type { Workspace } from '../runtime/workspace.js'
import { sha256 } from '../runtime/workspace.js'
import type { Emitter } from './events.js'
import type { ToolSchema } from './llm.js'

export const MAX_READ_CHARS = 20_000
export const MAX_TOOL_RESULT_CHARS = 8_000

export const RUN_COMMAND_TOOL = 'run_command'

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出当前工程里的文件（相对路径），用于了解现状。会自动忽略 node_modules/dist。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '可选，只看某个子目录，例如 client/src' } },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取一个文件的内容。修改任何文件之前必须先读它，保证补丁能精确匹配。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对工程根目录的路径' } },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '整文件写入（新建或整体重写）。小改动优先用 apply_patch，能少输出很多 token。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工程根目录的路径' },
          content: { type: 'string', description: '完整文件内容（UTF-8、LF、不要写 BOM）' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description:
        '按 search/replace 块改文件。格式：*** Update File: <路径> 然后 <<<<<<< SEARCH / 旧内容 / ======= / 新内容 / >>>>>>> REPLACE。支持一个补丁里多文件、多块；也支持 *** Add File: / *** Delete File:。SEARCH 必须与文件当前内容逐字符一致且唯一。',
      parameters: {
        type: 'object',
        properties: { patch: { type: 'string', description: '补丁全文' } },
        required: ['patch'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在工程根目录执行命令做自检。只允许 npm / node / npx，不能带引号与 shell 元字符（例如 && | > $ %）。常用：npm run typecheck、npm run build:h5。',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: '例如 npm run typecheck' } },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '本轮需求已全部改完时调用。调用前请确保没有遗漏页面注册与接口封装。',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: '一句话说明这轮改了什么' } },
        required: ['summary'],
        additionalProperties: false,
      },
    },
  },
]

export interface ToolContext {
  config: AppConfig
  workspace: Workspace
  logger: Logger
  emit: Emitter
  changes: FileChange[]
  state: { finished: boolean; summary: string; errors: string[] }
}

export interface ToolOutcome {
  /** 回灌给模型的文本。 */
  text: string
  ok: boolean
}

function asString(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key]
  if (typeof value === 'string' && value.length > 0) return value
  if (required) throw ApiError.badRequest('缺少参数 ' + key)
  return ''
}

function clip(text: string, limit = MAX_TOOL_RESULT_CHARS): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + '\n…[已截断，共 ' + text.length + ' 字符]'
}

function recordWrite(ctx: ToolContext, rel: string, action: FileChange['action'], bytes: number, content?: string): void {
  ctx.changes.push({ path: rel, action, bytes })
  ctx.emit('file', { path: rel, action, bytes })
  if (content) ctx.logger.debug('写入文件 ' + rel + '（' + sha256(content).slice(0, 8) + '）')
}

/** 执行一个工具调用。返回的文本会作为 tool 消息回灌给模型。 */
export async function executeTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case 'list_files': {
      const sub = typeof args.path === 'string' ? args.path : ''
      const files = await ctx.workspace.listFiles(600)
      const filtered = sub ? files.filter((file) => file.path.startsWith(sub.replace(/\/+$/, '') + '/')) : files
      const lines = filtered.map((file) => file.path + '  (' + file.size + 'B)')
      ctx.emit('tool', { name, ok: true, detail: '列出 ' + filtered.length + ' 个文件', args })
      return { ok: true, text: clip(lines.join('\n') || '(空目录)') }
    }
    case 'read_file': {
      const rel = asString(args, 'path')
      const content = await ctx.workspace.readFile(rel)
      ctx.emit('tool', { name, ok: true, detail: '读取 ' + rel + '（' + content.length + ' 字符）', args })
      if (content.length > MAX_READ_CHARS) {
        return { ok: true, text: '（已截断，仅前 ' + MAX_READ_CHARS + ' 字符）\n' + content.slice(0, MAX_READ_CHARS) }
      }
      return { ok: true, text: content }
    }
    case 'write_file': {
      const rel = asString(args, 'path')
      const content = typeof args.content === 'string' ? args.content : ''
      const result = await ctx.workspace.writeFile(rel, content)
      recordWrite(ctx, result.path, result.action, result.bytes, content)
      ctx.emit('tool', { name, ok: true, detail: result.action + ' ' + result.path, args: { path: result.path } })
      return { ok: true, text: '已' + (result.action === 'create' ? '新建' : '更新') + ' ' + result.path + '（' + result.bytes + 'B）' }
    }
    case 'apply_patch': {
      const patch = asString(args, 'patch')
      const ops = parsePatch(patch)
      const touched: string[] = []
      for (const op of ops) {
        if (op.kind === 'delete') {
          const existed = await ctx.workspace.deleteFile(op.path)
          if (!existed) throw ApiError.notFound('要删除的文件不存在：' + op.path)
          recordWrite(ctx, op.path, 'delete', 0)
          touched.push('删除 ' + op.path)
          continue
        }
        if (op.kind === 'add') {
          const result = await ctx.workspace.writeFile(op.path, op.content)
          recordWrite(ctx, result.path, result.action, result.bytes, op.content)
          touched.push('新建 ' + result.path)
          continue
        }
        const current = await ctx.workspace.readFile(op.path)
        let next = current
        for (const block of op.blocks) next = applyBlock(op.path, next, block)
        const result = await ctx.workspace.writeFile(op.path, next)
        recordWrite(ctx, result.path, result.action, result.bytes, next)
        touched.push('修改 ' + result.path + '（' + op.blocks.length + ' 处）')
      }
      ctx.emit('tool', { name, ok: true, detail: touched.join('；'), args: { files: ops.map((op) => op.path) } })
      return { ok: true, text: touched.join('\n') }
    }
    case RUN_COMMAND_TOOL: {
      const command = asString(args, 'command')
      const result = await runCommand(command, {
        cwd: ctx.workspace.root,
        timeoutMs: ctx.config.commandTimeoutMs,
        outputLimit: 4000,
      })
      const text = [
        '$ ' + command,
        'exit=' + result.exitCode + (result.timedOut ? '（超时已终止）' : ''),
        result.stdout.trim() ? '--- stdout ---\n' + result.stdout.trim() : '',
        result.stderr.trim() ? '--- stderr ---\n' + result.stderr.trim() : '',
      ]
        .filter(Boolean)
        .join('\n')
      ctx.emit('tool', { name, ok: result.ok, detail: command + ' → exit=' + result.exitCode, args: { command } })
      return { ok: result.ok, text: clip(text) }
    }
    case 'finish': {
      const summary = asString(args, 'summary', false) || '已完成本轮修改'
      ctx.state.finished = true
      ctx.state.summary = summary
      ctx.emit('tool', { name, ok: true, detail: summary, args: { summary } })
      return { ok: true, text: '已记录：' + summary }
    }
    default:
      throw ApiError.badRequest('未知工具：' + name + '（可用：' + TOOL_SCHEMAS.map((schema) => schema.function.name).join('、') + '）')
  }
}