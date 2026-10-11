import { useState, type ReactNode } from 'react'
import type { PreviewInfoDTO } from '../api/types'
import { Button, Empty, StatusDot } from './ui'

export function PreviewPanel({
  preview,
  busy,
  onStart,
  onStop,
  onRefresh,
  onExport,
  message,
  hasFiles,
  apiOrigin,
  onSetApiOrigin,
}: {
  preview: PreviewInfoDTO | null
  busy: boolean
  onStart: () => void
  onStop: () => void
  onRefresh: () => void
  onExport: () => void
  message: string | null
  /** 工作区里是否已经有生成出来的文件；没有就先别让点启动。 */
  hasFiles: boolean
  /** 项目当前指向的后端：null = 生成工程自带的 Node 后端。 */
  apiOrigin: string | null
  onSetApiOrigin: (value: string | null) => void
}): ReactNode {
  const [apiInput, setApiInput] = useState('')
  const running = preview?.status === 'running' && preview.url

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-1.5">
        <span className="text-[11px] text-slate-500">接口来自</span>
        <span className="text-[11px] text-slate-300">{apiOrigin ? apiOrigin : '生成工程自带 Node 后端'}</span>
        <input
          className="ml-auto w-60 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200"
          placeholder="http://127.0.0.1:8081（自己的后端）"
          value={apiInput}
          onChange={(event) => setApiInput(event.target.value)}
        />
        <Button disabled={busy} onClick={() => onSetApiOrigin(apiInput.trim() === '' ? null : apiInput.trim())}>
          指向它
        </Button>
        {apiOrigin && (
          <Button disabled={busy} onClick={() => onSetApiOrigin(null)}>
            用自带的
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <StatusDot status={preview?.status ?? 'stopped'} />
        <span className="text-[11px] text-slate-400">
          {preview ? preview.status + (preview.clientPort ? ' · client ' + preview.clientPort + ' / api ' + preview.apiPort : '') : '预览未启动'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <>
              <a
                className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                href={preview.url}
                target="_blank"
                rel="noreferrer"
              >
                新标签打开
              </a>
              <Button onClick={onRefresh} disabled={busy}>
                重启
              </Button>
              <Button onClick={onStop} disabled={busy}>
                停止
              </Button>
            </>
          ) : (
            <Button kind="primary" onClick={onStart} disabled={busy || !hasFiles}>
              启动预览
            </Button>
          )}
          <Button onClick={onExport} disabled={busy}>
            导出 zip
          </Button>
        </div>
      </div>

      {!hasFiles && !preview && (
        <p className="border-b border-slate-800 px-3 py-1.5 text-[11px] text-amber-300">
          还没有生成任何文件：先在下方对话里描述需求，等它生成 client/ 与 server/ 之后再启动预览。
        </p>
      )}
      {message && <p className="border-b border-slate-800 px-3 py-1 text-[11px] text-amber-300">{message}</p>}

      <div className="min-h-0 flex-1 bg-slate-950 p-3">
        {running ? (
          <iframe
            key={preview.url}
            title="预览"
            src={preview.url}
            className="mx-auto h-full w-full max-w-[480px] rounded-lg border border-slate-800 bg-white"
          />
        ) : (
          <Empty>
            {preview?.error
              ? '预览启动失败：' + preview.error
              : '预览未运行。点「启动预览」会同时拉起生成工程的 client(H5) 与 server，首次需要装依赖。'}
          </Empty>
        )}
      </div>
    </div>
  )
}