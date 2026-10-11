import { useCallback, useRef, useState } from 'react'
import { api, streamMessage } from '../api/client'
import type { MessageDTO, SseEnvelope, SseEventName } from '../api/types'

export interface RunEvent {
  id: number
  at: string
  envelope: SseEnvelope
}

export interface RunStreamState {
  events: RunEvent[]
  messages: MessageDTO[]
  running: boolean
  /** 模型输出的实时文本增量（delta 事件累积）。 */
  liveText: string
  error: string | null
  send: (content: string) => Promise<void>
  loadMessages: () => Promise<void>
  reset: () => void
}

const EVENT_LABEL: Record<SseEventName, string> = {
  plan: '计划',
  tool: '工具',
  file: '文件',
  build: '构建',
  preview: '预览',
  delta: '模型',
  done: '完成',
  error: '错误',
}

export function eventTitle(event: RunEvent): string {
  const { envelope } = event
  const label = EVENT_LABEL[envelope.type] ?? envelope.type
  const data = envelope.data as Record<string, unknown>
  switch (envelope.type) {
    case 'plan':
      return label + '：' + String(data.summary ?? '')
    case 'tool':
      return label + ' · ' + String(data.name ?? '') + (data.ok ? ' ✓ ' : ' ✗ ') + String(data.detail ?? '')
    case 'file':
      return label + ' · ' + String(data.action ?? '') + ' ' + String(data.path ?? '')
    case 'build':
      return label + (data.ok ? '通过' : '失败') + '（第 ' + String(Number(data.attempt ?? 0) + 1) + ' 次尝试）'
    case 'preview':
      return label + '：' + String(data.message ?? '')
    case 'done':
      return label + '：' + String(data.summary ?? '')
    case 'error':
      return label + '：' + String(data.message ?? '')
    default:
      return label
  }
}

export function eventTone(type: SseEventName): string {
  if (type === 'error') return 'border-rose-800 bg-rose-950/40 text-rose-200'
  if (type === 'done') return 'border-emerald-800 bg-emerald-950/40 text-emerald-200'
  if (type === 'build') return 'border-amber-800 bg-amber-950/30 text-amber-200'
  if (type === 'preview') return 'border-sky-800 bg-sky-950/30 text-sky-200'
  return 'border-slate-800 bg-slate-900/60 text-slate-300'
}

/** projectId 决定往哪个项目发需求；为 null 时 send 直接报错。 */
export function useRunStream(projectId: string | null): RunStreamState {
  const [events, setEvents] = useState<RunEvent[]>([])
  const [messages, setMessages] = useState<MessageDTO[]>([])
  const [running, setRunning] = useState(false)
  const [liveText, setLiveText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const counter = useRef(0)

  const reset = useCallback(() => {
    setEvents([])
    setMessages([])
    setLiveText('')
    setError(null)
  }, [])

  const loadMessages = useCallback(async () => {
    if (!projectId) return
    try {
      setMessages(await api.listMessages(projectId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [projectId])

  const send = useCallback(
    async (content: string) => {
      if (!projectId) {
        setError('先选择或新建一个项目')
        return
      }
      setRunning(true)
      setError(null)
      setLiveText('')
      setEvents([])
      // 乐观显示用户消息，流结束后再用服务端的完整列表覆盖。
      const optimistic: MessageDTO = {
        id: 'local-' + Date.now(),
        projectId,
        role: 'user',
        content,
        runId: null,
        createdAt: new Date().toISOString(),
      }
      setMessages((current) => [...current, optimistic])
      try {
        await streamMessage(projectId, content, {
          onEvent: (envelope) => {
            counter.current += 1
            setEvents((current) => [...current, { id: counter.current, at: envelope.at, envelope }])
            if (envelope.type === 'delta') {
              const text = String((envelope.data as { text?: string }).text ?? '')
              setLiveText((current) => current + text)
            }
            if (envelope.type === 'error') {
              setError(String((envelope.data as { message?: string }).message ?? '生成失败'))
            }
          },
          onClose: () => setRunning(false),
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setRunning(false)
      } finally {
        void loadMessages()
      }
    },
    [projectId, loadMessages],
  )

  return { events, messages, running, liveText, error, send, loadMessages, reset }
}