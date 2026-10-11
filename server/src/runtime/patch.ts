// 给模型用的补丁格式（search/replace 块），比行号 diff 更抗漂移：
//
//   *** Update File: client/src/pages/index/index.vue
//   <<<<<<< SEARCH
//   <旧内容，必须与文件里完全一致>
//   =======
//   <新内容>
//   >>>>>>> REPLACE
//
// 另支持 *** Add File: / *** Delete File:。
import { ApiError } from '../util/errors.js'

export interface UpdateBlock {
  search: string
  replace: string
}

export type PatchOp =
  | { kind: 'add'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; blocks: UpdateBlock[] }

interface UpdateOp {
  kind: 'update'
  path: string
  blocks: UpdateBlock[]
}

interface AddOp {
  kind: 'add'
  path: string
  content: string
}

const FILE_HEADER = /^\*\*\* (Update|Add|Delete) File: (.+)$/

export function parsePatch(patch: string): PatchOp[] {
  const lines = String(patch ?? '').replace(/\r\n/g, '\n').split('\n')
  const ops: PatchOp[] = []
  let addTarget: AddOp | null = null
  let addLines: string[] = []
  let updateTarget: UpdateOp | null = null
  let index = 0

  while (index < lines.length) {
    const line = lines[index] as string
    const header = FILE_HEADER.exec(line)

    if (header) {
      // 结束上一段 Add
      if (addTarget) addTarget.content = addLines.join('\n').replace(/\n$/, '')
      addTarget = null
      addLines = []
      updateTarget = null

      const action = header[1]
      const file = (header[2] as string).trim()
      if (!file) throw ApiError.badRequest('补丁里的文件路径为空')
      if (action === 'Add') {
        const op: AddOp = { kind: 'add', path: file, content: '' }
        ops.push(op)
        addTarget = op
      } else if (action === 'Delete') {
        ops.push({ kind: 'delete', path: file })
      } else {
        const op: UpdateOp = { kind: 'update', path: file, blocks: [] }
        ops.push(op)
        updateTarget = op
      }
      index += 1
      continue
    }

    if (addTarget) {
      addLines.push(line)
      index += 1
      continue
    }

    if (updateTarget && line.startsWith('<<<<<<<')) {
      const searchLines: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] as string).startsWith('=======')) {
        searchLines.push(lines[index] as string)
        index += 1
      }
      index += 1
      const replaceLines: string[] = []
      while (index < lines.length && !(lines[index] as string).startsWith('>>>>>>>')) {
        replaceLines.push(lines[index] as string)
        index += 1
      }
      index += 1
      updateTarget.blocks.push({ search: searchLines.join('\n'), replace: replaceLines.join('\n') })
      continue
    }

    index += 1
  }

  if (addTarget) addTarget.content = addLines.join('\n').replace(/\n$/, '')

  if (ops.length === 0) {
    throw ApiError.badRequest('补丁里没有解析到任何 *** Update/Add/Delete File 段')
  }
  for (const op of ops) {
    if (op.kind === 'update' && op.blocks.length === 0) {
      throw ApiError.badRequest(op.path + ' 的补丁缺少 <<<<<<< SEARCH / ======= / >>>>>>> REPLACE 块')
    }
  }
  return ops
}

/** 应用单个 search/replace 块；找不到（或命中多次）时给出可读错误。 */
export function applyBlock(filePath: string, source: string, block: UpdateBlock): string {
  const search = block.search.replace(/\n$/, '')
  const haystack = source.replace(/\r\n/g, '\n')
  if (search === '') throw ApiError.badRequest(filePath + ' 的 SEARCH 块为空')
  const first = haystack.indexOf(search)
  if (first < 0) {
    const head = search.split('\n')[0] ?? ''
    throw ApiError.badRequest(
      '在 ' + filePath + ' 里找不到 SEARCH 内容（首行：' + head.slice(0, 80) + '）。请先 read_file 确认当前内容再重新生成补丁。',
    )
  }
  if (haystack.indexOf(search, first + 1) >= 0) {
    throw ApiError.badRequest('SEARCH 内容在 ' + filePath + ' 里出现多次，请带上更多上下文以保证唯一匹配')
  }
  return haystack.slice(0, first) + block.replace + haystack.slice(first + search.length)
}