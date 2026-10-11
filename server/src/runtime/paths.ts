// 生成代码只能落在 var/workspaces/<projectId>/ 里：所有路径先过这里，越界即抛错。
import fs from 'node:fs'
import path from 'node:path'
import { ApiError } from '../util/errors.js'

/** 生成工程里被忽略的目录：不参与索引、构建产物不导出。 */
export const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-h5', '.vite', '.cache', 'coverage'])

const WINDOWS_DRIVE = /^[A-Za-z]:/

/** 归一化相对路径：统一分隔符、去掉前导 ./、保留大小写。 */
export function normalizeRelPath(rel: string): string {
  const raw = String(rel ?? '').replace(/\\/g, '/').trim()
  const withoutPrefix = raw.replace(/^\.\//, '')
  return withoutPrefix
}

/**
 * 把相对路径解析成工作目录内的绝对路径。
 * 拒绝：空路径、绝对路径、盘符路径、包含 .. 的路径、含 NUL 的路径；
 * 再逐级检查最深已存在祖先的 realpath，防止符号链接逃逸。
 */
export function resolveInside(rootReal: string, rel: string): string {
  const norm = normalizeRelPath(rel)
  if (!norm || norm === '.') throw ApiError.pathViolation('路径不能为空')
  if (norm.includes('\0')) throw ApiError.pathViolation('路径包含非法字符')
  if (norm.startsWith('/') || WINDOWS_DRIVE.test(norm) || norm.startsWith('~')) {
    throw ApiError.pathViolation('只接受工作目录内的相对路径：' + rel)
  }
  const segments = norm.split('/').filter((s) => s !== '' && s !== '.')
  if (segments.some((s) => s === '..')) throw ApiError.pathViolation('路径越界（含 ..）：' + rel)
  const abs = path.resolve(rootReal, ...segments)
  const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep
  if (abs !== rootReal && !abs.startsWith(rootWithSep)) {
    throw ApiError.pathViolation('路径越界：' + rel)
  }
  let probe = abs
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const real = fs.realpathSync(probe)
  if (real !== rootReal && !real.startsWith(rootWithSep)) {
    throw ApiError.pathViolation('路径经符号链接逃逸：' + rel + ' -> ' + real)
  }
  return abs
}

/** 校验后返回相对路径（用于索引与事件），同时确认落点在工作目录内。 */
export function toRelPath(rootReal: string, abs: string): string {
  const rel = path.relative(rootReal, abs).replace(/\\/g, '/')
  if (!rel || rel.startsWith('..')) throw ApiError.pathViolation('路径越界：' + abs)
  return rel
}