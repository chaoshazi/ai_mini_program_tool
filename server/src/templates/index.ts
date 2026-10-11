// 工程模板：模板目录里的文件是真实文件（不是字符串常量），预览/构建时按占位符渲染到项目工作目录。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FileChange } from '../store/types.js'
import type { Workspace } from '../runtime/workspace.js'

/** 模板目录（tsx 直跑时是 src/templates/project，编译后是 dist/templates/project）。 */
export function templateRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'project')
}

/** 占位符清单：新增占位符时改这里 + 模板里的 `{{名字}}`，并在 templates 技能里同步。 */
export const PLACEHOLDERS = {
  appName: '工程名（kebab-case，用作 package.json 的 name）',
  appTitle: '应用中文名（页面标题 / tabBar 文案）',
  description: '一句话描述，写进 README 与 package.json',
  createdAt: '生成时间（ISO 字符串）',
} as const

export type PlaceholderName = keyof typeof PLACEHOLDERS

export interface TemplateSpec {
  appName: string
  appTitle: string
  description: string
  createdAt?: string
}

const TEXT_EXTENSIONS = new Set([
  '.ts', '.vue', '.json', '.md', '.mjs', '.js', '.css', '.html', '.txt', '.yml', '.yaml', '.gitignore', '',
])

const PLACEHOLDER_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g

export function renderString(text: string, spec: TemplateSpec): string {
  return text.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    const value = (spec as unknown as Record<string, unknown>)[name]
    if (value === undefined) throw new Error('模板占位符未提供取值：' + match)
    return String(value)
  })
}

/** 把模板渲染进工作目录，返回新写入的文件清单（相对路径）。 */
export async function renderProject(workspace: Workspace, spec: TemplateSpec): Promise<FileChange[]> {
  const root = templateRoot()
  if (!fs.existsSync(root)) throw new Error('模板目录不存在：' + root)
  const full: TemplateSpec = { ...spec, createdAt: spec.createdAt ?? new Date().toISOString() }
  const changes: FileChange[] = []

  const walk = async (dir: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        await walk(abs)
        continue
      }
      const rel = path.relative(root, abs).replace(/\\/g, '/')
      const ext = path.extname(entry.name)
      if (TEXT_EXTENSIONS.has(ext) || entry.name === '.gitignore') {
        const text = await fsp.readFile(abs, 'utf8')
        const result = await workspace.writeFile(rel, renderString(text, full))
        changes.push({ path: result.path, action: result.action, bytes: result.bytes })
      } else {
        const buf = await fsp.readFile(abs)
        const target = workspace.resolve(rel)
        await fsp.mkdir(path.dirname(target), { recursive: true })
        await fsp.writeFile(target, buf)
        changes.push({ path: rel, action: 'create', bytes: buf.byteLength })
      }
    }
  }

  await walk(root)
  return changes
}

/** 渲染后自检：产物里不应残留任何未替换的占位符。 */
export function findUnrenderedPlaceholders(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(PLACEHOLDER_PATTERN)).map((match) => match[1] ?? '')))
}