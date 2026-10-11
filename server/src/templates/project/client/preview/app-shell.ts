// 预览外壳：顶部导航 + 当前页面 + 底部 tabBar + toast，模拟小程序的基本外观。
import {
  computed,
  defineComponent,
  h,
  onMounted,
  onUnmounted,
  provide,
  watch,
  type Component,
  type PropType,
} from 'vue'
import { createPageRuntime, PAGE_RUNTIME } from './page-runtime'
import type { PagesJson } from './types'
import type { UniShim } from './uni-shim'

// 页面组件全量预加载（页面数量少，省掉异步组件的 Suspense 复杂度）。
const pageModules = import.meta.glob('../src/**/*.vue', { eager: true, import: 'default' }) as Record<string, Component>

// pages.json 里的路径是相对 src/ 的（如 pages/index/index），glob 的 key 是相对本文件的。
function resolvePage(path: string): Component {
  const found = pageModules['../src/' + path + '.vue']
  return found ?? missingPage(path)
}

/** 生成一个「找不到页面」占位组件（把缺失路径写进消息里，避免往页面组件上塞多余属性）。 */
function missingPage(path: string): Component {
  return defineComponent({
    name: 'MissingPage',
    setup: () => () => h('div', { class: 'mw-missing' }, 'pages.json 里没有找到页面：' + path),
  })
}

const PageHost = defineComponent({
  name: 'PageHost',
  props: {
    pagePath: { type: String, required: true },
    query: { type: Object as PropType<Record<string, string>>, required: true },
  },
  setup(props) {
    const runtime = createPageRuntime()
    provide(PAGE_RUNTIME, runtime)
    onMounted(() => runtime.mount(props.query))
    watch(
      () => props.query,
      (next) => runtime.mount(next),
    )
    onUnmounted(() => runtime.unmount())
    return () => {
      const page = resolvePage(props.pagePath)
      return h(page, { query: props.query })
    }
  },
})

export function createAppShell(shim: UniShim, pages: PagesJson): Component {
  const globalTitle = (pages.globalStyle?.navigationBarTitleText as string | undefined) ?? ''
  const tabBar = pages.tabBar
  const tabPages = new Set((tabBar?.list ?? []).map((item) => item.pagePath))

  return defineComponent({
    name: 'MiniwechatAppShell',
    setup() {
      const path = shim.currentPath
      const query = shim.currentQuery
      const showTabBar = computed(() => tabPages.has(path.value))
      const title = computed(() => {
        const page = pages.pages.find((item) => item.path === path.value)
        return (page?.style?.navigationBarTitleText as string | undefined) ?? globalTitle
      })

      return () =>
        h('div', { class: 'mw-app' }, [
          h('header', { class: 'mw-navbar' }, title.value),
          h('main', { class: 'mw-app__body' }, [
            h(PageHost, {
              key: path.value + '|' + JSON.stringify(query.value),
              pagePath: path.value,
              query: query.value,
            }),
          ]),
          showTabBar.value && tabBar
            ? h(
                'nav',
                {
                  class: 'mw-tabbar',
                  style: { background: tabBar.backgroundColor ?? '#ffffff' },
                },
                tabBar.list.map((item) =>
                  h(
                    'button',
                    {
                      key: item.pagePath,
                      class: ['mw-tabbar__item', item.pagePath === path.value ? 'is-active' : ''],
                      style: {
                        color: item.pagePath === path.value ? (tabBar.selectedColor ?? '#07c160') : (tabBar.color ?? '#7a7e83'),
                      },
                      onClick: () => shim.switchTab('/' + item.pagePath),
                    },
                    item.text,
                  ),
                ),
              )
            : null,
          shim.toast.value.visible
            ? h('div', { class: ['mw-toast', shim.toast.value.icon === 'loading' ? 'is-loading' : ''] }, shim.toast.value.title)
            : null,
        ])
    },
  })
}