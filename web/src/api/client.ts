// 控制台与工具后端之间的唯一通道：统一 { code, message, data } 与 SSE 解析。
import type {
  ApiResponse,
  ExportResultDTO,
  FileEntryDTO,
  HealthDTO,
  MessageDTO,
  PreviewInfoDTO,
  ProjectDTO,
  RunDTO,
  SseEnvelope,
} from './types'

/** 开发时由 vite 代理到 9320；生产由工具后端托管同源，所以用相对路径。 */
const BASE = ''

export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await response.text()
  let body: ApiResponse<T> | null = null
  try {
    body = text ? (JSON.parse(text) as ApiResponse<T>) : null
  } catch {
    throw new ApiError(response.status, '后端返回了非 JSON 内容：' + text.slice(0, 200))
  }
  if (!body || body.code !== 0) {
    throw new ApiError(body?.code ?? response.status, body?.message ?? '请求失败 HTTP ' + response.status)
  }
  return body.data
}

export const api = {
  health: () => request<HealthDTO>('/api/health'),

  listProjects: () => request<ProjectDTO[]>('/api/projects'),
  createProject: (name: string, description: string) =>
    request<ProjectDTO>('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) }),
  deleteProject: (id: string) => request<{ id: string }>('/api/projects/' + id, { method: 'DELETE' }),
  /** 指定这个项目用哪个后端：null = 生成工程自带的 Node 后端，否则是外部地址（例如自己的 PHP 接口）。 */
  setApiOrigin: (id: string, apiOrigin: string | null) =>
    request<ProjectDTO>('/api/projects/' + id, { method: 'PATCH', body: JSON.stringify({ apiOrigin }) }),

  listFiles: (id: string) => request<FileEntryDTO[]>('/api/projects/' + id + '/files'),
  readFile: (id: string, path: string) =>
    request<{ path: string; content: string }>('/api/projects/' + id + '/files/' + path),

  listMessages: (id: string) => request<MessageDTO[]>('/api/projects/' + id + '/messages'),
  listRuns: (id: string) => request<RunDTO[]>('/api/projects/' + id + '/runs'),

  getPreview: (id: string) => request<PreviewInfoDTO>('/api/projects/' + id + '/preview'),
  startPreview: (id: string) =>
    request<PreviewInfoDTO>('/api/projects/' + id + '/preview', { method: 'POST', body: JSON.stringify({ action: 'start' }) }),
  stopPreview: (id: string) => request<{ projectId: string }>('/api/projects/' + id + '/preview', { method: 'DELETE' }),

  exportProject: (id: string) =>
    request<ExportResultDTO>('/api/projects/' + id + '/export', { method: 'POST', body: '{}' }),
}

export interface StreamHandlers {
  onEvent: (envelope: SseEnvelope) => void
  /** 收到 done / error / 流结束都会调用，用来收尾。 */
  onClose: () => void
}

/**
 * 发一条需求并消费 SSE。用 fetch + ReadableStream 而不是 EventSource：
 * /messages 是 POST，EventSource 只支持 GET。
 */
export async function streamMessage(projectId: string, content: string, handlers: StreamHandlers): Promise<void> {
  const controller = new AbortController()
  try {
    const response = await fetch(BASE + '/api/projects/' + projectId + '/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: controller.signal,
    })
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      throw new ApiError(response.status, '发起生成失败 HTTP ' + response.status + ' ' + text.slice(0, 200))
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
        if (dataLine) {
          try {
            const envelope = JSON.parse(dataLine.slice(6)) as SseEnvelope
            if (envelope.type) handlers.onEvent(envelope)
          } catch {
            // 忽略解析不了的帧（例如心跳注释）
          }
        }
        index = buffer.indexOf('\n\n')
      }
    }
  } finally {
    handlers.onClose()
  }
}