// 该文件由 `npm run gen:types`（server/scripts/gen-web-types.ts）从
// server/src/api/schemas.ts 的 web-types 区段自动生成，请勿手改。

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
