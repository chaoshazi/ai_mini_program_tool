// 待办清单接口封装：页面只调这里的方法，不直接写 URL。
import { api } from './request'
import type { HealthInfo, Todo } from './types'

export type { Todo, HealthInfo }

export function fetchTodos(): Promise<Todo[]> {
  return api.get<Todo[]>('/api/todos')
}

export function createTodo(title: string): Promise<Todo> {
  return api.post<Todo>('/api/todos', { title })
}

export function updateTodo(id: number, patch: Partial<Pick<Todo, 'title' | 'done'>>): Promise<Todo> {
  return api.patch<Todo>('/api/todos/' + id, patch)
}

export function removeTodo(id: number): Promise<{ id: number }> {
  return api.del<{ id: number }>('/api/todos/' + id)
}

export function fetchHealth(): Promise<HealthInfo> {
  return api.get<HealthInfo>('/api/health')
}