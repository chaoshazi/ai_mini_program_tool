// 离线脚手架：没有 LLM_API_KEY 时按模板生成示例工程，保证「生成 → 构建 → 预览 → 导出」全链路可跑通。
import type { Project } from '../store/types.js'
import type { Emitter } from './events.js'
import type { Workspace } from '../runtime/workspace.js'
import { renderProject } from '../templates/index.js'

export interface ScaffoldResult {
  created: number
  skipped: boolean
  reason: string
}

/** 新项目：整目录渲染模板；已有文件的工程不覆盖，只提示离线模式不改代码。 */
export async function scaffoldWorkspace(workspace: Workspace, project: Project, emit: Emitter): Promise<ScaffoldResult> {
  const existing = await workspace.listFiles(50)
  const hasProject = existing.some((file) => file.path === 'package.json')
  if (hasProject) {
    const reason = '离线模式（未配置 LLM_API_KEY）不修改已有工程，本轮只做构建与预览校验'
    emit('plan', { summary: reason, steps: ['沿用现有工程文件', '构建校验', '预览刷新'], mode: 'offline' })
    return { created: 0, skipped: true, reason }
  }

  emit('plan', {
    summary: '离线脚手架模式：按内置模板生成「' + project.name + '」示例工程（待办清单）',
    steps: [
      'client/：uni-app（Vue3 + TS）页面 + 请求封装',
      'server/：Node + Express 接口',
      '根目录：workspaces 脚本与 README',
      '构建校验 → 预览就绪',
    ],
    mode: 'offline',
  })

  const changes = await renderProject(workspace, {
    appName: toAppName(project.name),
    appTitle: project.name,
    description: project.description || '由 miniwechat 离线脚手架生成的示例工程',
  })
  for (const change of changes) {
    emit('file', { path: change.path, action: change.action, bytes: change.bytes })
  }
  return { created: changes.length, skipped: false, reason: '离线脚手架已生成 ' + changes.length + ' 个文件' }
}

/** 项目名 -> 合法的 npm 包名（小写、连字符）。 */
export function toAppName(name: string): string {
  const normalized = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const ascii = normalized.replace(/[^a-z0-9-]/g, '')
  return ascii || 'miniwechat-app'
}