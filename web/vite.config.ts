import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 控制台开发端口 5180；/api 与 /preview 代理到工具后端 9320（含 WebSocket，供预览 HMR 透传）
const TOOL_SERVER = process.env.MW_SERVER_ORIGIN ?? 'http://127.0.0.1:9320'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': { target: TOOL_SERVER, changeOrigin: true },
      '/preview': { target: TOOL_SERVER, changeOrigin: true, ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
})