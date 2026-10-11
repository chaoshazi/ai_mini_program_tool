// 从 server/src/api/schemas.ts 的 web-types 区段生成 web/src/api/types.ts，
// 保证控制台与后端的事件契约只有一份定义。改完 schema 必须重跑本脚本。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WEB_TYPES_BEGIN, WEB_TYPES_END } from '../src/api/schemas.js'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(serverRoot, '..')
const schemaPath = path.join(serverRoot, 'src', 'api', 'schemas.ts')

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^$ + '{' + '}' + ()|[\]\\]/g, '\\$&')
}
const targetPath = path.join(repoRoot, 'web', 'src', 'api', 'types.ts')

export function generateWebTypes(): string {
  const source = fs.readFileSync(schemaPath, 'utf8')
  // 只认「整行就是标记」的那两行，避免命中注释里出现的同名文字
  const beginMatch = new RegExp('^[ \t]*' + escapeRegExp(WEB_TYPES_BEGIN) + '[ \t]*$', 'm').exec(source)
  const endMatch = new RegExp('^[ \t]*' + escapeRegExp(WEB_TYPES_END) + '[ \t]*$', 'm').exec(source)
  if (!beginMatch || !endMatch || endMatch.index < beginMatch.index) {
    throw new Error('schemas.ts 缺少 web-types 区段标记（需要独占一行的 region 标记）')
  }
  const body = source.slice(beginMatch.index + beginMatch[0].length, endMatch.index).trim()
  return [
    '// 该文件由 `npm run gen:types`（server/scripts/gen-web-types.ts）从',
    '// server/src/api/schemas.ts 的 web-types 区段自动生成，请勿手改。',
    '',
    body,
    '',
  ].join('\n')
}

const check = process.argv.includes('--check')
const content = generateWebTypes()
if (check) {
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : ''
  if (current !== content) {
    console.error('web/src/api/types.ts 与 schemas.ts 不一致，请运行：npm run gen:types')
    process.exit(1)
  }
  console.log('web 类型与 schemas.ts 一致')
  process.exit(0)
}
fs.mkdirSync(path.dirname(targetPath), { recursive: true })
fs.writeFileSync(targetPath, content, 'utf8')
console.log('已生成 ' + path.relative(repoRoot, targetPath))