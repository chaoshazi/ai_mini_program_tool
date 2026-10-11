// {{appTitle}} 自带后端：Express + 内存存储（默认落盘到 data/todos.json）。
// 端口读 MW_API_PORT，默认 9401（预览与 npm run dev 都从这里取）。
import cors from 'cors'
import express from 'express'
import { registerRoutes } from './routes.js'
import { createStore } from './store.js'

const port = Number(process.env.MW_API_PORT ?? '9401')
const host = process.env.MW_API_HOST ?? '127.0.0.1'
const dataFile = process.env.MW_DATA_FILE ?? 'data/todos.json'

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const store = createStore({ file: dataFile === 'memory' ? null : dataFile })
registerRoutes(app, store)

const server = app.listen(port, host, () => {
  console.log('[' + 'api' + '] {{appTitle}} 后端已启动 http://' + host + ':' + port + '/api/health')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}