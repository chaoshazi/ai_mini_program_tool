// tsc 只产出 js；模板是运行期要读的真实文件，必须单独拷到 dist，保证 node dist/index.js 也能读到。
import { cp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const from = path.join(serverRoot, 'src', 'templates', 'project')
const to = path.join(serverRoot, 'dist', 'templates', 'project')
await mkdir(path.dirname(to), { recursive: true })
await cp(from, to, { recursive: true })
console.log('已拷贝模板 ' + path.relative(serverRoot, from) + ' -> ' + path.relative(serverRoot, to))