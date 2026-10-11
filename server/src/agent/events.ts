// SSE 事件发送器：统一补上 runId 与时间戳，事件名即 type。
import type { SseEventMap, SseEventName } from '../api/schemas.js'
import { SSE_EVENT_NAMES } from '../api/schemas.js'

export interface SseFrame {
  event: SseEventName
  data: string
}

export interface Emitter {
  <K extends SseEventName>(type: K, data: SseEventMap[K]): void
  /** 已发出的事件类型顺序，测试用来断言事件契约。 */
  readonly sent: SseEventName[]
}

export function createEmitter(runId: string, sink: (frame: SseFrame) => void): Emitter {
  const sent: SseEventName[] = []
  const emitter = (<K extends SseEventName>(type: K, data: SseEventMap[K]): void => {
    if (!SSE_EVENT_NAMES.includes(type)) throw new Error('未知 SSE 事件类型：' + type)
    sent.push(type)
    sink({
      event: type,
      data: JSON.stringify({ type, runId, at: new Date().toISOString(), data }),
    })
  }) as Emitter & { sent: SseEventName[] }
  Object.defineProperty(emitter, 'sent', { get: () => sent, enumerable: false })
  return emitter
}