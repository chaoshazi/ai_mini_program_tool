// 每个项目一个隔离工作目录 var/workspaces/<projectId>/：文件读写一律通过这里，保证不越界。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { ApiError } from '../util/errors.js'
import { IGNORED_DIRS, normalizeRelPath, resolveInside } from './paths.js'

export interface FileEntry {
  path: string
  size: number
}

export interface WriteResult {
  path: string
  action: 'create' | 'update'
  bytes: number
  hash: string
}

export class Workspace {
  private readonly rootReal: string

  private constructor(
    readonly projectId: string,
    readonly root: string,
  ) {
    this.rootReal = fs.realpathSync(root)
  }

  /** 取（必要时创建）项目工作目录。 */
  static ensure(workspacesDir: string, projectId: string): Workspace {
    const root = path.join(workspacesDir, projectId)
    fs.mkdirSync(root, { recursive: true })
    return new Workspace(projectId, root)
  }

  /** 相对路径 -> 绝对路径，越界直接抛 PATH_VIOLATION。 */
  resolve(rel: string): string {
    return resolveInside(this.rootReal, rel)
  }

  exists(rel: string): boolean {
    return fs.existsSync(this.resolve(rel))
  }

  async readFile(rel: string): Promise<string> {
    const abs = this.resolve(rel)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw ApiError.notFound('文件不存在：' + normalizeRelPath(rel))
    }
    return fsp.readFile(abs, 'utf8')
  }

  async writeFile(rel: string, content: string): Promise<WriteResult> {
    const abs = this.resolve(rel)
    const existed = fs.existsSync(abs)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const text = String(content ?? '').replace(/\r\n/g, '\n')
    if (!/\.(png|jpg|jpeg|gif|ico|woff2?|ttf)$/i.test(abs) && text.startsWith('\uFEFF')) {
      // 统一 UTF-8 无 BOM
      await fsp.writeFile(abs, text.slice(1), 'utf8')
    } else {
      await fsp.writeFile(abs, text, 'utf8')
    }
    const buf = await fsp.readFile(abs)
    return {
      path: normalizeRelPath(rel),
      action: existed ? 'update' : 'create',
      bytes: buf.byteLength,
      hash: sha256(buf),
    }
  }

  async deleteFile(rel: string): Promise<boolean> {
    const abs = this.resolve(rel)
    if (!fs.existsSync(abs)) return false
    await fsp.rm(abs, { recursive: true, force: true })
    return true
  }

  /** 递归列出生成产物（忽略 node_modules 等），按路径排序。 */
  async listFiles(limit = 2000): Promise<FileEntry[]> {
    const out: FileEntry[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (out.length >= limit) return
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          await walk(path.join(dir, entry.name))
        } else if (entry.isFile()) {
          const abs = path.join(dir, entry.name)
          const stat = await fsp.stat(abs)
          out.push({ path: path.relative(this.root, abs).replace(/\\/g, '/'), size: stat.size })
        }
      }
    }
    if (fs.existsSync(this.root)) await walk(this.root)
    out.sort((a, b) => a.path.localeCompare(b.path))
    return out
  }

  /** 计算索引（路径 + 大小 + hash）写回数据库，内容本身不落库。 */
  async snapshotIndex(): Promise<Array<{ path: string; size: number; hash: string }>> {
    const files = await this.listFiles(5000)
    const out: Array<{ path: string; size: number; hash: string }> = []
    for (const file of files) {
      const abs = this.resolve(file.path)
      const buf = await fsp.readFile(abs)
      out.push({ path: file.path, size: file.size, hash: sha256(buf) })
    }
    return out
  }

  /** 清空目录内容（保留目录本身）。 */
  async wipe(): Promise<void> {
    const entries = await fsp.readdir(this.root, { withFileTypes: true })
    for (const entry of entries) {
      await fsp.rm(path.join(this.root, entry.name), { recursive: true, force: true })
    }
  }
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** 目录大小（用于日志展示），跳过 node_modules。 */
export async function dirSize(dir: string): Promise<number> {
  let total = 0
  const walk = async (current: string): Promise<void> => {
    const entries = await fsp.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(path.join(current, entry.name))
      } else if (entry.isFile()) {
        total += (await fsp.stat(path.join(current, entry.name))).size
      }
    }
  }
  if (fs.existsSync(dir)) await walk(dir)
  return total
}

/**
 * 删除目录，失败就等待重试：Windows 上刚停掉的子进程（Vite/tsx）会短暂占住句柄，
 * 直接 rmdir 会 EBUSY。重试仍失败不抛错，返回 false 由调用方决定怎么记日志。
 */
export async function removeDirWithRetry(dir: string, attempts = 5, delayMs = 400): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fsp.rm(dir, { recursive: true, force: true, maxRetries: 2 })
      return true
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  return !fs.existsSync(dir)
}