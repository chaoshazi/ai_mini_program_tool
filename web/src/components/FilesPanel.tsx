import { type ReactNode } from 'react'
import type { FileEntryDTO } from '../api/types'
import { Empty } from './ui'

export function FilesPanel({
  files,
  selectedPath,
  content,
  loading,
  onSelect,
}: {
  files: FileEntryDTO[]
  selectedPath: string | null
  content: string
  loading: boolean
  onSelect: (path: string) => void
}): ReactNode {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-72 shrink-0 overflow-auto border-r border-slate-800 py-2">
        {files.length === 0 ? (
          <Empty>还没有文件，发起一轮生成后会出现在这里</Empty>
        ) : (
          <ul>
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelect(file.path)}
                  className={
                    'block w-full truncate px-3 py-1 text-left text-[11px] transition ' +
                    (file.path === selectedPath ? 'bg-emerald-950/60 text-emerald-100' : 'text-slate-400 hover:bg-slate-800/60')
                  }
                  title={file.path + '（' + file.size + 'B）'}
                >
                  {file.path}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-slate-950 p-3">
        {selectedPath ? (
          <>
            <p className="mb-2 text-[11px] text-slate-500">{selectedPath}</p>
            <pre className="text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300">
              {loading ? '加载中…' : content}
            </pre>
          </>
        ) : (
          <Empty>左侧选一个文件查看内容</Empty>
        )}
      </div>
    </div>
  )
}