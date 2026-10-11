// 工具的对外契约：统一响应体、错误码、SSE 事件。
// 本文件里被 region 标记包围的 web-types 区段是前端类型的唯一来源，改完必须跑 npm run gen:types 同步 web/src/api/types.ts。
import { ApiCode } from '../util/errors.js'

export { ApiCode }

// #region web-types
/** 统一响应体：code = 0 表示成功，其余见 ApiCode。 */
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export interface ApiErrorBody {
  code: number
  message: string
  detail: unknown
}

export type ProjectStatusDTO = 'draft' | 'generating' | 'ready' | 'error'
export type GenerationModeDTO = 'llm' | 'offline'
export type PreviewStatusDTO = 'stopped' | 'starting' | 'running' | 'error'

export interface ProjectDTO {
  id: string
  name: string
  description: string
  status: ProjectStatusDTO
  mode: GenerationModeDTO
  previewStatus: PreviewStatusDTO
  previewUrl: string | null
  /** 外部后端地址（自己的 PHP/其它后端）；为空表示用生成工程自带的 Node 后端。 */
  apiOrigin: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageDTO {
  id: string
  projectId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  runId: string | null
  createdAt: string
}

export interface FileEntryDTO {
  path: string
  size: number
}

export interface FileChangeDTO {
  path: string
  action: 'create' | 'update' | 'delete'
  bytes: number
}

export interface BuildCheckDTO {
  name: string
  command: string
  ok: boolean
  exitCode: number | null
  durationMs: number
  errors: string[]
  output: string
}

export interface BuildReportDTO {
  ok: boolean
  attempt: number
  checks: BuildCheckDTO[]
  installed: boolean
}

export interface RunDTO {
  id: string
  projectId: string
  status: 'running' | 'succeeded' | 'failed'
  mode: GenerationModeDTO
  summary: string
  files: FileChangeDTO[]
  build: BuildReportDTO | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface PreviewInfoDTO {
  projectId: string
  status: 'starting' | 'running' | 'error' | 'stopped'
  /** 带路径前缀的预览地址，例如 /preview/prj_xxx/ */
  url: string
  clientPort: number
  apiPort: number
  startedAt: string
  error?: string
}

export interface ExportResultDTO {
  filename: string
  url: string
  bytes: number
  entries: number
}

export interface HealthDTO {
  ok: boolean
  name: string
  schemaVersion: number
  llm: { enabled: boolean; model: string; baseUrl: string }
  previews: number
}

export const SSE_EVENT_NAMES = ['plan', 'tool', 'file', 'build', 'preview', 'delta', 'done', 'error'] as const
export type SseEventName = (typeof SSE_EVENT_NAMES)[number]

/** 每个 SSE 帧形如：event: <type>\n data: <SseEnvelope>\n\n */
export interface SseEnvelope<T = unknown> {
  type: SseEventName
  runId: string
  at: string
  data: T
}

export interface SsePlanData {
  summary: string
  steps: string[]
  mode: GenerationModeDTO
}

export interface SseToolData {
  name: string
  ok: boolean
  detail: string
  args: Record<string, unknown>
}

export interface SseFileData {
  path: string
  action: 'create' | 'update' | 'delete'
  bytes: number
}

export interface SseBuildData {
  ok: boolean
  attempt: number
  checks: Array<{ name: string; ok: boolean; durationMs: number; errors: string[] }>
  /** 是否为了这次构建装了依赖。 */
  installed: boolean
}

export interface SsePreviewData {
  status: 'starting' | 'running' | 'error' | 'skipped'
  url: string | null
  message: string
}

/** 模型输出的文本增量，用于控制台实时显示。 */
export interface SseDeltaData {
  text: string
}

export interface SseDoneData {
  runId: string
  mode: GenerationModeDTO
  summary: string
  files: FileChangeDTO[]
  build: BuildReportDTO | null
  previewUrl: string | null
}

export interface SseErrorData {
  code: number
  message: string
  detail: unknown
}

export interface SseEventMap {
  plan: SsePlanData
  tool: SseToolData
  file: SseFileData
  build: SseBuildData
  preview: SsePreviewData
  delta: SseDeltaData
  done: SseDoneData
  error: SseErrorData
}
// #endregion web-types

export const WEB_TYPES_BEGIN = '// #region web-types'
export const WEB_TYPES_END = '// #endregion web-types'

/** 校验 PATCH 里传进来的 apiOrigin：空串/null 表示清空；否则必须是 http(s) 开头的地址。 */
export function normalizeApiOrigin(value: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, message: 'apiOrigin 必须是字符串或 null' }
  const trimmed = value.trim().replace(/\/+$/, '')
  if (trimmed === '') return { ok: true, value: null }
  if (!/^https?:\/\/[^\s]+$/.test(trimmed)) {
    return { ok: false, message: 'apiOrigin 必须是 http:// 或 https:// 开头的地址，例如 http://127.0.0.1:8081' }
  }
  return { ok: true, value: trimmed }
}

export const CODE_MESSAGES: Record<number, string> = {
  [ApiCode.OK]: 'ok',
  [ApiCode.BAD_REQUEST]: '请求参数不合法',
  [ApiCode.NOT_FOUND]: '资源不存在',
  [ApiCode.CONFLICT]: '资源状态冲突',
  [ApiCode.PATH_VIOLATION]: '路径越界，已拒绝',
  [ApiCode.COMMAND_REJECTED]: '命令不在白名单内，已拒绝',
  [ApiCode.BUILD_FAILED]: '构建校验失败',
  [ApiCode.LLM_FAILED]: '模型调用失败',
  [ApiCode.PREVIEW_FAILED]: '预览启动失败',
  [ApiCode.INTERNAL]: '服务内部错误',
}