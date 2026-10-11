// uni API 垫片：把 uni.request / navigateTo / showToast / storage 等常用 API 映射到浏览器实现。
// 只覆盖模板用到的子集，扩展时同步在 src/types/uni-globals.d.ts 里补类型。
import { ref, shallowRef, type Ref } from 'vue'
import type { PagesJson, TabBarItem, UniModalOptions, UniRequestOptions, UniResponse, UniToastOptions } from './types'
import { resolveRequestUrl } from './request-url'

export interface ToastState {
  visible: boolean
  title: string
  icon: string
}

export interface UniShim {
  /** 当前页面路径（不含前导斜杠），例如 pages/index/index */
  currentPath: Ref<string>
  currentQuery: Ref<Record<string, string>>
  toast: Ref<ToastState>
  tabBarItems: TabBarItem[]
  install(): void
  navigateTo(url: string): void
  redirectTo(url: string): void
  reLaunch(url: string): void
  switchTab(url: string): void
  navigateBack(delta?: number): void
  showToast(options: UniToastOptions): void
}

const BASE = import.meta.env.BASE_URL || '/'
const STORAGE_PREFIX = 'miniwechat:'

function splitUrl(url: string): { path: string; query: Record<string, string> } {
  const raw = String(url ?? '')
  const [pathPart, searchPart] = raw.split('?')
  const path = (pathPart ?? '').replace(/^\/+/, '').replace(/\/+$/, '')
  const query: Record<string, string> = {}
  for (const pair of (searchPart ?? '').split('&')) {
    if (!pair) continue
    const [key, value] = pair.split('=')
    if (key) query[decodeURIComponent(key)] = decodeURIComponent(value ?? '')
  }
  return { path, query }
}

function parseLocation(pages: PagesJson): { path: string; query: Record<string, string> } {
  const rest = decodeURIComponent(location.pathname.slice(BASE.length))
  const { path, query } = splitUrl(rest)
  if (!path) return { path: pages.pages[0]?.path ?? '', query: {} }
  for (const [key, value] of new URLSearchParams(location.search)) query[key] = value
  return { path, query }
}

function buildUrl(path: string, query: Record<string, string>): string {
  const search = new URLSearchParams(query).toString()
  return BASE + path + (search ? '?' + search : '')
}

export function createUniShim(pages: PagesJson): UniShim {
  const currentPath = shallowRef('')
  const currentQuery = ref<Record<string, string>>({})
  const toast = ref<ToastState>({ visible: false, title: '', icon: 'none' })
  const tabBarItems = pages.tabBar?.list ?? []
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  const apply = (): void => {
    const next = parseLocation(pages)
    currentPath.value = next.path
    currentQuery.value = next.query
    document.title = next.path
  }

  const go = (url: string, mode: 'push' | 'replace'): void => {
    const next = splitUrl(url)
    const target = buildUrl(next.path, next.query)
    if (mode === 'push') history.pushState({ path: next.path }, '', target)
    else history.replaceState({ path: next.path }, '', target)
    apply()
  }

  const showToast = (options: UniToastOptions): void => {
    toast.value = { visible: true, title: options.title ?? '', icon: options.icon ?? 'none' }
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      toast.value = { ...toast.value, visible: false }
    }, options.duration ?? 2000)
  }

  const request = (options: UniRequestOptions): Promise<UniResponse> => {
    // 调用方（client/src/api/request.ts）通常已经拼过 VITE_API_BASE，这里必须幂等，
    // 拼两遍会变成 /preview/<id>/preview/<id>/api/xxx，被转给 vite 后拿回 index.html
    const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
    const method = (options.method ?? 'GET').toUpperCase()
    const query = method === 'GET' || method === 'HEAD' ? buildQuery(options.data) : ''
    const target = resolveRequestUrl(options.url, base) + query
    return fetch(target, {
      method,
      headers: { 'content-type': 'application/json', ...(options.header ?? {}) },
      body: query ? undefined : method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(options.data ?? {}),
    })
      .then(async (response) => {
        const text = await response.text()
        let data: unknown = text
        try {
          data = text ? JSON.parse(text) : null
        } catch {
          data = text
        }
        const result: UniResponse = { statusCode: response.status, data, header: {} }
        options.success?.(result)
        options.complete?.(result)
        return result
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        options.fail?.({ errMsg: 'request:fail ' + message })
        options.complete?.({ errMsg: message })
        throw error
      })
  }

  const uniApi = {
    request,
    navigateTo: (options: { url: string }) => go(options.url, 'push'),
    redirectTo: (options: { url: string }) => go(options.url, 'replace'),
    reLaunch: (options: { url: string }) => go(options.url, 'replace'),
    switchTab: (options: { url: string }) => go(options.url, 'push'),
    navigateBack: (options?: { delta?: number }) => history.go(-(options?.delta ?? 1)),
    showToast,
    hideToast: () => {
      toast.value = { ...toast.value, visible: false }
    },
    showLoading: (options: { title?: string }) => showToast({ title: options.title ?? '加载中', icon: 'loading', duration: 1000 }),
    hideLoading: () => {
      toast.value = { ...toast.value, visible: false }
    },
    showModal: (options: UniModalOptions) => {
      const confirmed = window.confirm([options.title, options.content].filter(Boolean).join('\n\n'))
      options.success?.({ confirm: confirmed, cancel: !confirmed })
    },
    setNavigationBarTitle: (options: { title: string }) => {
      document.title = options.title
    },
    getSystemInfoSync: () => ({
      platform: 'devtools',
      brand: 'miniwechat-preview',
      model: 'browser',
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      statusBarHeight: 0,
      system: navigator.userAgent,
    }),
    stopPullDownRefresh: () => undefined,
    setStorageSync: (key: string, value: unknown) => {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
    },
    getStorageSync: (key: string): unknown => {
      const raw = localStorage.getItem(STORAGE_PREFIX + key)
      if (raw === null) return ''
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    },
    removeStorageSync: (key: string) => {
      localStorage.removeItem(STORAGE_PREFIX + key)
    },
    clearStorageSync: () => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key)
      }
    },
    getLaunchOptionsSync: () => ({ path: currentPath.value, query: currentQuery.value, scene: 1001 }),
    $emit: (): void => undefined,
    $on: (): void => undefined,
    $off: (): void => undefined,
  }

  return {
    currentPath,
    currentQuery,
    toast,
    tabBarItems,
    install() {
      ;(globalThis as Record<string, unknown>).uni = uniApi
      window.addEventListener('popstate', apply)
      apply()
    },
    navigateTo: (url) => go(url, 'push'),
    redirectTo: (url) => go(url, 'replace'),
    reLaunch: (url) => go(url, 'replace'),
    switchTab: (url) => go(url, 'push'),
    navigateBack: (delta = 1) => history.go(-delta),
    showToast,
  }
}

function buildQuery(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (value === undefined || value === null) continue
    params.append(key, String(value))
  }
  const text = params.toString()
  return text ? '?' + text : ''
}