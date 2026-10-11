// 本工程 v1 不安装 @dcloudio/uni-app（浏览器预览由 client/preview/ 提供等价实现），
// 这里声明页面用到的生命周期 API 供 vue-tsc 校验。
// 一旦安装官方依赖（HBuilderX / uni-app CLI），请删除本文件，避免与官方类型冲突。
declare module '@dcloudio/uni-app' {
  export function onLaunch(hook: (options?: Record<string, unknown>) => void): void
  export function onLoad(hook: (query?: Record<string, string>) => void): void
  export function onReady(hook: () => void): void
  export function onShow(hook: () => void): void
  export function onHide(hook: () => void): void
  export function onUnload(hook: () => void): void
  export function onPullDownRefresh(hook: () => void): void
  export function onReachBottom(hook: () => void): void
  export function onError(hook: (message: string) => void): void
}