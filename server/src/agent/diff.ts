// 对比两次文件索引，得出这一轮的新增/修改/删除清单（控制台与 done 事件用）。
import type { FileChange } from '../store/types.js'

export interface IndexEntry {
  path: string
  size: number
  hash: string
}

export function diffIndex(before: IndexEntry[], after: IndexEntry[]): FileChange[] {
  const left = new Map(before.map((entry) => [entry.path, entry]))
  const right = new Map(after.map((entry) => [entry.path, entry]))
  const changes: FileChange[] = []
  for (const [path, entry] of right) {
    const previous = left.get(path)
    if (!previous) changes.push({ path, action: 'create', bytes: entry.size })
    else if (previous.hash !== entry.hash) changes.push({ path, action: 'update', bytes: entry.size })
  }
  for (const path of left.keys()) {
    if (!right.has(path)) changes.push({ path, action: 'delete', bytes: 0 })
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}