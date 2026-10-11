// 预览入口：把标准 uni-app 源码（src/）挂到浏览器里跑。
// 组成 = pages.json 驱动路由 + uni API 垫片 + 内置组件 + App.vue 外壳。
import { createApp, defineComponent, h } from 'vue'
import App from '../src/App.vue'
import pagesJson from '../src/pages.json'
import { createUniShim } from './uni-shim'
import { registerUniComponents } from './uni-components'
import { createAppShell } from './app-shell'
import type { PagesJson } from './types'
import './preview.css'

const pages = pagesJson as PagesJson
const shim = createUniShim(pages)
shim.install()
const Shell = createAppShell(shim, pages)

const Root = defineComponent({
  name: 'MiniwechatPreviewRoot',
  setup() {
    // App.vue 只做外壳（跑 onLaunch、挂全局样式），页面内容由 Shell 渲染进它的默认插槽。
    return () => h(App, null, { default: () => h(Shell) })
  },
})

const app = createApp(Root)
registerUniComponents(app)
app.mount('#app')