// 存储层实体：文件内容落磁盘（var/workspaces/<id>），库里只存索引与 hash。
export type ProjectStatus = 'draft' | 'generating' | 'ready' | 'error'
/** 生成模式：llm = 走模型，offline = 无 Key 时的离线脚手架降级。 */
export type GenerationMode = 'llm' | 'offline'
export type RunStatus = 'running' | 'succeeded' | 'failed'

export interface Project {
  id: string
  name: string
  description: string
  status: ProjectStatus
  mode: GenerationMode
  previewStatus: 'stopped' | 'starting' | 'running' | 'error'
  previewUrl: string | null
  /** 外部后端地址（例如你自己的 PHP 接口）。非空时预览不再起生成工程自带的 Node 后端，而是把 /preview/<id>/api 反代到它。 */
  apiOrigin: string | null
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  projectId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  runId: string | null
  createdAt: string
}

export interface FileChange {
  path: string
  action: 'create' | 'update' | 'delete'
  bytes: number
}

export interface RunRecord {
  id: string
  projectId: string
  status: RunStatus
  mode: GenerationMode
  summary: string
  files: FileChange[]
  build: BuildReport | null
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface FileRecord {
  projectId: string
  path: string
  size: number
  hash: string
  updatedAt: string
}

export interface BuildCheck {
  name: string
  command: string
  ok: boolean
  exitCode: number | null
  durationMs: number
  /** 失败时截断后的错误摘要，用于回灌给模型。 */
  errors: string[]
  output: string
}

export interface BuildReport {
  ok: boolean
  attempt: number
  checks: BuildCheck[]
  /** 首次进入构建前是否执行了依赖安装。 */
  installed: boolean
}