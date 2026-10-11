// 浏览器预览运行时的 Vite 配置（单入口，root 指到 preview/）。
// 工具会注入：MW_PREVIEW_BASE（路径前缀）、MW_CLIENT_PORT（端口）、VITE_API_BASE（写在 client/.env.local）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { uniTagAlias } from './uni-tag-alias'

const previewDir = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.resolve(previewDir, '..')
const base = process.env.MW_PREVIEW_BASE ?? '/'
const port = Number(process.env.MW_CLIENT_PORT ?? '9400')
const apiPort = process.env.MW_API_PORT ?? '9401'

export default defineConfig({
  root: previewDir,
  base,
  envDir: clientDir,
  plugins: [uniTagAlias(), vue()],
  resolve: {
    alias: {
      '@': path.resolve(clientDir, 'src'),
      // 预览不装 @dcloudio/uni-app，用本地实现顶上生命周期 API（真机编译用官方包）。
      '@dcloudio/uni-app': path.resolve(previewDir, 'uni-app-lifecycle.ts'),
    },
  },
  server: {
    host: '127.0.0.1',
    // 自己跑 npm run dev 时没有工具注入的 env，这里用同源代理把 /api 转给自带后端
    proxy: { '/api': { target: 'http://127.0.0.1:' + apiPort, changeOrigin: true } },
    port,
    strictPort: true,
    // 预览通过工具后端的路径前缀代理访问，HMR 的 WebSocket 与代理叠加容易不稳定，这里关闭；
    // 直接 `npm run dev:h5` 自己调页面时可以打开。
    hmr: false,
    watch: { ignored: ['**/node_modules/**', '**/dist/**', '**/dist-h5/**'] },
  },
  build: {
    outDir: path.resolve(clientDir, 'dist-h5'),
    emptyOutDir: true,
    target: 'es2020',
  },
})