// 预览运行时用到的 pages.json 结构与 uni API 类型（只覆盖模板会用到的那部分）。
export interface PageConfig {
  path: string
  style?: Record<string, unknown>
}

export interface TabBarItem {
  pagePath: string
  text: string
}

export interface TabBarConfig {
  color?: string
  selectedColor?: string
  backgroundColor?: string
  borderStyle?: 'black' | 'white'
  list: TabBarItem[]
}

export interface PagesJson {
  pages: PageConfig[]
  tabBar?: TabBarConfig
  globalStyle?: Record<string, unknown>
}

export interface UniResponse {
  statusCode: number
  data: unknown
  header: Record<string, string>
}

export interface UniRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD'
  data?: unknown
  header?: Record<string, string>
  timeout?: number
  success?: (res: UniResponse) => void
  fail?: (err: { errMsg: string }) => void
  complete?: (res: unknown) => void
}

export interface UniToastOptions {
  title: string
  icon?: 'success' | 'error' | 'loading' | 'none'
  duration?: number
}

export interface UniModalOptions {
  title?: string
  content?: string
  showCancel?: boolean
  success?: (res: { confirm: boolean; cancel: boolean }) => void
  fail?: (err: { errMsg: string }) => void
}