// 统一请求封装：所有接口调用都从这里走，方便统一加头、统一错误处理。
// baseURL 读 VITE_API_BASE：
//   - 浏览器预览时由工具注入为 /preview/<projectId>（本前缀不含 /api，调用方统一写 '/api/xxx'）（同源，无 CORS）
//   - 真机/生产请把 VITE_API_BASE 改成你自己的后端地址（例如 https://api.example.com）
import type { ApiEnvelope } from './types'

const BASE_URL = String(import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '')

export interface RequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: unknown
  header?: Record<string, string>
}

export function request<T>(options: RequestOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    uni.request({
      url: BASE_URL + options.url,
      method: options.method ?? 'GET',
      data: options.data,
      header: { 'content-type': 'application/json', ...(options.header ?? {}) },
      success: (response) => {
        const raw = response.data as unknown
        if (typeof raw === 'string') {
          // 常见原因：地址拼错、打到前端 dev server 上拿回了 index.html
          reject(new Error('接口没返回 JSON（HTTP ' + response.statusCode + '）：' + raw.slice(0, 120)))
          return
        }
        const body = raw as ApiEnvelope<T> | null
        if (body && typeof body === 'object' && 'code' in body) {
          if (body.code === 0) resolve(body.data)
          else reject(new Error(body.message || '接口返回错误 code=' + body.code))
          return
        }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(body as unknown as T)
        else reject(new Error('HTTP ' + response.statusCode))
      },
      fail: (error) => reject(new Error(error.errMsg)),
    })
  })
}

export const api = {
  get: <T>(url: string, data?: unknown) => request<T>({ url, method: 'GET', data }),
  post: <T>(url: string, data?: unknown) => request<T>({ url, method: 'POST', data }),
  patch: <T>(url: string, data?: unknown) => request<T>({ url, method: 'PATCH', data }),
  del: <T>(url: string, data?: unknown) => request<T>({ url, method: 'DELETE', data }),
}

export const API_BASE = BASE_URL