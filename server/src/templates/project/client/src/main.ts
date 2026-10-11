// 标准 uni-app（Vue3）入口：HBuilderX / uni-app CLI 编译时使用。
// 浏览器预览走 preview/main.ts，不经过这里。
import { createSSRApp } from 'vue'
import App from './App.vue'

export function createApp() {
  const app = createSSRApp(App)
  return { app }
}