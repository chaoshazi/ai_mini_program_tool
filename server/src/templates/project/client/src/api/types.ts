// 前后端共享的接口返回约定（后端 server/src/routes 里用同一份结构）。
export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

export interface Todo {
  id: number
  title: string
  done: boolean
  createdAt: string
}

export interface HealthInfo {
  ok: boolean
  uptime: number
  todos: number
  version: string
}