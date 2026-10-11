// 预览时通过 vite alias 顶掉 '@dcloudio/uni-app'：把官方生命周期 API 接到 page-runtime 上。
// 真机/微信开发者工具编译走的是官方包，本文件不参与。
import { onMounted } from 'vue'
import { usePageRuntime } from './page-runtime'

type Hook = (...args: never[]) => void

function register(kind: 'load' | 'show' | 'ready' | 'hide' | 'unload', hook: Hook, fallbackOnMount: boolean): void {
  const runtime = usePageRuntime()
  if (runtime) {
    runtime.register(kind, hook as (...args: unknown[]) => void)
    return
  }
  if (fallbackOnMount) onMounted(() => (hook as () => void)())
}

export function onLoad(hook: (query: Record<string, string>) => void): void {
  register('load', hook as Hook, true)
}

export function onReady(hook: () => void): void {
  register('ready', hook as Hook, true)
}

export function onShow(hook: () => void): void {
  register('show', hook as Hook, true)
}

export function onHide(hook: () => void): void {
  register('hide', hook as Hook, false)
}

export function onUnload(hook: () => void): void {
  register('unload', hook as Hook, false)
}

/** App.vue 的应用级钩子：预览下只在挂载时触发一次。 */
export function onLaunch(hook: (options?: Record<string, unknown>) => void): void {
  onMounted(() => hook?.({ path: location.pathname, scene: 1001 }))
}

/** 预览不模拟下拉刷新/触底事件，保留空实现以免源码引用时报错。 */
export function onPullDownRefresh(_hook: () => void): void {
  void _hook
}

export function onReachBottom(_hook: () => void): void {
  void _hook
}

export function onError(_hook: (message: string) => void): void {
  void _hook
}