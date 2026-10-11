// 全局 uni API 的最小类型声明（只覆盖模板用到的子集）。
// 生产/真机建议安装 @dcloudio/types 并删除本文件。

interface UniResponse {
  statusCode: number
  data: unknown
  header: Record<string, string>
}

interface UniRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
  data?: unknown
  header?: Record<string, string>
  timeout?: number
  success?: (res: UniResponse) => void
  fail?: (err: { errMsg: string }) => void
  complete?: (res: unknown) => void
}

interface UniToastOptions {
  title: string
  icon?: 'success' | 'error' | 'loading' | 'none'
  duration?: number
}

interface UniModalOptions {
  title?: string
  content?: string
  showCancel?: boolean
  success?: (res: { confirm: boolean; cancel: boolean }) => void
  fail?: (err: { errMsg: string }) => void
}

interface UniSystemInfo {
  platform: string
  brand: string
  model: string
  windowWidth: number
  windowHeight: number
  statusBarHeight: number
  system: string
}

declare const uni: {
  request(options: UniRequestOptions): void
  navigateTo(options: { url: string }): void
  redirectTo(options: { url: string }): void
  reLaunch(options: { url: string }): void
  switchTab(options: { url: string }): void
  navigateBack(options?: { delta?: number }): void
  showToast(options: UniToastOptions): void
  hideToast(): void
  showLoading(options: { title?: string }): void
  hideLoading(): void
  showModal(options: UniModalOptions): void
  setNavigationBarTitle(options: { title: string }): void
  getSystemInfoSync(): UniSystemInfo
  stopPullDownRefresh(): void
  setStorageSync(key: string, value: unknown): void
  getStorageSync(key: string): unknown
  removeStorageSync(key: string): void
  clearStorageSync(): void
  getLaunchOptionsSync(): { path: string; query: Record<string, string>; scene: number }
}