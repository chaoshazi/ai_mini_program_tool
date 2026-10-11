// 导出：把工作目录里的生成物（不含 node_modules / 构建产物）打成 zip。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { ApiError } from '../util/errors.js'
import type { Workspace } from './workspace.js'
import { createZip, type ZipEntry } from './zip.js'

/** 导出时排除的目录/文件：依赖与构建产物不进压缩包。 */
const EXPORT_EXCLUDES = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-h5',
  '.vite',
  '.cache',
  '.env.local',
  // PHP / Laravel 后端的依赖目录，导出包里没必要带上（composer install 可重建）
  'vendor',
])

export interface ExportResult {
  filename: string
  bytes: number
  entries: number
  buffer: Buffer
}

export async function collectEntries(workspace: Workspace): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = []
  const walk = async (dir: string): Promise<void> => {
    const dirents = await fsp.readdir(dir, { withFileTypes: true })
    for (const dirent of dirents) {
      if (EXPORT_EXCLUDES.has(dirent.name)) continue
      const abs = path.join(dir, dirent.name)
      if (dirent.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!dirent.isFile()) continue
      const rel = path.relative(workspace.root, abs).replace(/\\/g, '/')
      entries.push({ name: rel, data: await fsp.readFile(abs) })
    }
  }
  await walk(workspace.root)
  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

export async function buildExport(workspace: Workspace, filename: string): Promise<ExportResult> {
  const entries = await collectEntries(workspace)
  if (entries.length === 0) throw ApiError.badRequest('工作目录还是空的，先生成代码再导出')
  const hasReadme = entries.some((entry) => entry.name.toLowerCase() === 'readme.md')
  if (!hasReadme) throw ApiError.badRequest('缺少 README.md，导出包无法说明怎么导入运行')
  const buffer = createZip(entries)
  return { filename, bytes: buffer.byteLength, entries: entries.length, buffer }
}

/** 导出文件名固定形状，GET 下载时按同样的规则校验，避免路径穿越。 */
export function exportFilename(appName: string, stamp: string): string {
  const safe = String(appName ?? 'app')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return (safe || 'app') + '-' + stamp + '.zip'
}

export function assertSafeExportName(name: string): string {
  const base = path.basename(String(name ?? ''))
  if (!base || base !== String(name) || !base.endsWith('.zip')) {
    throw ApiError.badRequest('非法导出文件名：' + name)
  }
  return base
}

export function exportsDir(varDir: string): string {
  const dir = path.join(varDir, 'exports')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}