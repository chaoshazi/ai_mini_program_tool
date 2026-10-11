// 本地一键起前后端（零依赖）：client 走浏览器 H5 预览运行时，server 是自带 Node 接口。
// 用法：npm run dev    （Ctrl+C 一起退出）
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const clientPort = process.env.MW_CLIENT_PORT ?? '9400'
const apiPort = process.env.MW_API_PORT ?? '9401'

const childs = [
  spawn('npm', ['run', 'dev:h5'], {
    cwd: path.join(root, 'client'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, MW_CLIENT_PORT: clientPort, MW_API_PORT: apiPort, MW_PREVIEW_BASE: process.env.MW_PREVIEW_BASE ?? '/' },
  }),
  spawn('npm', ['run', 'dev'], {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, MW_API_PORT: apiPort },
  }),
]

console.log('client(H5) http://127.0.0.1:' + clientPort + '   api http://127.0.0.1:' + apiPort + '/api/health')

const shutdown = () => {
  for (const child of childs) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)