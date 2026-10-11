import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MessageDTO } from '../api/types'
import { eventTitle, eventTone, type RunEvent } from '../hooks/useRunStream'
import { Button, Empty } from './ui'

export function ChatPanel({
  events,
  messages,
  running,
  liveText,
  error,
  disabled,
  onSend,
}: {
  events: RunEvent[]
  messages: MessageDTO[]
  running: boolean
  liveText: string
  error: string | null
  disabled: boolean
  onSend: (content: string) => void
}): ReactNode {
  const [draft, setDraft] = useState('')
  const timelineRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = timelineRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [events.length, liveText])

  const submit = (): void => {
    const content = draft.trim()
    if (!content || running || disabled) return
    onSend(content)
    setDraft('')
  }

  return (
    <section className="flex w-[420px] shrink-0 flex-col border-l border-slate-800 bg-slate-950/60">
      <header className="border-b border-slate-800 px-3 py-2 text-xs font-semibold tracking-wide text-slate-300 uppercase">
        对话与生成过程
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3" ref={timelineRef}>
        {messages.length === 0 && events.length === 0 ? (
          <Empty>{disabled ? '先新建或选择一个项目' : '描述你要做的小程序，例如「做一个待办清单小程序」'}</Empty>
        ) : null}

        <div className="flex flex-col gap-2">
          {messages.map((message) => (
            <div
              key={message.id}
              className={
                'rounded-lg px-3 py-2 text-xs leading-relaxed ' +
                (message.role === 'user'
                  ? 'ml-6 bg-emerald-950/50 text-emerald-100'
                  : 'mr-6 border border-slate-800 bg-slate-900/60 text-slate-300')
              }
            >
              <p className="mb-1 text-[11px] text-slate-500">{message.role === 'user' ? '我' : '助手'}</p>
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          ))}

          {events.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              <p className="text-[11px] text-slate-500">本轮事件（{events.length}）</p>
              {events.map((event) => (
                <div key={event.id} className={'rounded border px-2 py-1 text-[11px] leading-relaxed ' + eventTone(event.envelope.type)}>
                  {eventTitle(event)}
                </div>
              ))}
            </div>
          )}

          {liveText && running && (
            <div className="mr-6 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-[11px] whitespace-pre-wrap text-slate-400">
              {liveText.slice(-800)}
            </div>
          )}

          {error && <div className="rounded border border-rose-800 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200">{error}</div>}
        </div>
      </div>

      <div className="border-t border-slate-800 p-3">
        <textarea
          value={draft}
          disabled={disabled || running}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
          }}
          rows={3}
          placeholder={running ? '生成中…（Cmd/Ctrl + Enter 发送）' : '描述需求，Cmd/Ctrl + Enter 发送'}
          className="w-full resize-none rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100 outline-none focus:border-emerald-600 disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">生成中会自动跑 typecheck 与 H5 构建，失败会回灌重试</span>
          <Button kind="primary" disabled={disabled || running || draft.trim().length === 0} onClick={submit}>
            {running ? '生成中…' : '发送'}
          </Button>
        </div>
      </div>
    </section>
  )
}