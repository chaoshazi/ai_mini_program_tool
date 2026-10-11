// 页面生命周期桥：uni-app 的 onLoad/onShow 在预览里靠这里被调用。
// 每渲染一页就新建一个 runtime，页面组件通过 inject 拿到它注册自己的钩子。
import { inject, type InjectionKey } from 'vue'

export interface PageRuntime {
  /** 页面 onLoad/onShow 等钩子排队注册，挂载后按顺序触发。 */
  register(kind: 'load' | 'show' | 'ready' | 'hide' | 'unload', hook: (...args: unknown[]) => void): void
  /** 页面挂载完成：触发 onLoad(query) 与 onShow()。 */
  mount(query: Record<string, string>): void
  /** 页面卸载：触发 onUnload，并清空钩子。 */
  unmount(): void
  /** 页面重新可见（切回该页）：触发 onShow。 */
  resume(): void
}

export const PAGE_RUNTIME: InjectionKey<PageRuntime> = Symbol('mw-page-runtime')

export function createPageRuntime(): PageRuntime {
  const hooks: Record<string, Array<(...args: unknown[]) => void>> = {
    load: [],
    show: [],
    ready: [],
    hide: [],
    unload: [],
  }
  const fire = (kind: string, ...args: unknown[]): void => {
    for (const hook of hooks[kind] ?? []) {
      try {
        hook(...args)
      } catch (error) {
        console.error('[preview] ' + kind + ' 钩子执行失败', error)
      }
    }
  }
  return {
    register(kind, hook) {
      hooks[kind]?.push(hook)
    },
    mount(query) {
      fire('load', query)
      fire('show')
      fire('ready')
    },
    unmount() {
      fire('unload')
    },
    resume() {
      fire('show')
    },
  }
}

export function usePageRuntime(): PageRuntime | null {
  return inject(PAGE_RUNTIME, null)
}