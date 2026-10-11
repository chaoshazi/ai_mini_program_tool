// 清理运行期与构建产物（只删生成物，不动源码）。用法：node scripts/clean.mjs [--all]
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const targets = ['var', 'server/dist', 'web/dist']
if (process.argv.includes('--all')) targets.push('node_modules', 'server/node_modules', 'web/node_modules')

for (const rel of targets) {
  const abs = path.resolve(root, rel)
  if (path.dirname(abs) !== root && !abs.startsWith(root + path.sep)) throw new Error('拒绝越界删除：' + abs)
  await rm(abs, { recursive: true, force: true })
  console.log('已删除 ' + rel)
}
console.log('var/ 会在下次启动时自动重建')