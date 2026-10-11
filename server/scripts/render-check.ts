// 渲染校验：在生成工程里临时造一个 SSR 入口，用真实页面组件 + 预览运行时装做一次服务端渲染，
// 断言渲染出的 HTML 里确实有页面内容。不用浏览器也能验证「页面可渲染」。
// 前置：目标工作目录已经 npm install 过（跑过 smoke:template 或一轮生成）。
// 用法：npm run check:render -- <projectId>   （默认 smoke-template）
import fsp from 'node:fs/promises'
import path from 'node:path'
import { loadConfig } from '../src/config.js'
import { spawnTokens } from '../src/runtime/command.js'
import { Workspace } from '../src/runtime/workspace.js'

const projectId = process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? 'smoke-template'
const config = loadConfig()
const workspace = Workspace.ensure(config.workspacesDir, projectId)
const clientDir = path.join(workspace.root, 'client')
const previewDir = path.join(clientDir, 'preview')
const outDir = path.join(previewDir, '.ssr-out')
const entryPath = path.join(previewDir, '.ssr-check.ts')
const entryRel = path.basename(entryPath)

// 临时入口：打桩浏览器 API -> 动态 import（避免顶层 await，生成工程的 build.target 是 es2020）
const ENTRY = [
  '// 由 server/scripts/render-check.ts 临时生成，跑完即删。',
  'const stubs = globalThis',
  'stubs.window = { addEventListener: () => undefined, innerWidth: 375, innerHeight: 667, confirm: () => true }',
  'const store = new Map()',
  'stubs.localStorage = {',
  '  getItem: (key) => (store.has(key) ? store.get(key) : null),',
  '  setItem: (key, value) => void store.set(key, value),',
  '  removeItem: (key) => void store.delete(key),',
  '}',
  "stubs.location = { pathname: '/', search: '' }",
  'stubs.history = { pushState: () => undefined, replaceState: () => undefined, go: () => undefined }',
  "Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'miniwechat-ssr' }, configurable: true })",
  '',
  'async function main() {',
  "  const { createSSRApp, h } = await import('vue')",
  "  const { renderToString } = await import('vue/server-renderer')",
  "  const App = (await import('../src/App.vue')).default",
  "  const pagesJson = (await import('../src/pages.json')).default",
  '  // document 必须等 vue 加载完成后再补：@vue/runtime-dom 特性探测时要求 document 未定义。',
  "  stubs.document = { title: '' }",
  "  const { createUniShim } = await import('./uni-shim')",
  "  const { registerUniComponents } = await import('./uni-components')",
  "  const { createAppShell } = await import('./app-shell')",
  '  const pages = pagesJson',
  '  const shim = createUniShim(pages)',
  '  shim.install()',
  '  const Shell = createAppShell(shim, pages)',
  '  const Root = { setup: () => () => h(App, null, { default: () => h(Shell) }) }',
  '  const app = createSSRApp(Root)',
  '  registerUniComponents(app)',
  '  const html = await renderToString(app)',
  "  process.stdout.write('__HTML__' + html)",
  '}',
  'main().catch((error) => {',
  '  console.error(error)',
  '  process.exit(1)',
  '})',
  '',
].join('\n')

await fsp.writeFile(entryPath, ENTRY, 'utf8')

const cleanup = async (): Promise<void> => {
  await fsp.rm(entryPath, { force: true })
  await fsp.rm(outDir, { recursive: true, force: true })
}

// vite 的 --config 相对路径按 client 解析；--ssr 入口必须是绝对路径，且 Windows 下要用反斜杠。
const entryArg = process.platform === 'win32' ? entryPath.replace(/\//g, '\\') : entryPath
const scriptArg = path.join('.ssr-out', entryRel.replace(/\.ts$/, '.js'))

const build = await spawnTokens(
  ['npx', 'vite', 'build', '--config', 'preview/vite.config.ts', '--ssr', entryArg, '--outDir', '.ssr-out'],
  { cwd: clientDir, timeoutMs: 180_000, outputLimit: 8000 },
).done
if (!build.ok) {
  console.error('SSR 构建失败：\n' + build.stdout + build.stderr)
  await cleanup()
  process.exit(1)
}

const run = await spawnTokens(['node', scriptArg], { cwd: previewDir, timeoutMs: 60_000, outputLimit: 400_000 }).done
await cleanup()

if (!run.ok) {
  console.error('SSR 渲染失败：\n' + (run.stdout + run.stderr).slice(0, 4000))
  process.exit(1)
}

const marker = run.stdout.indexOf('__HTML__')
if (marker < 0) {
  console.error('没有拿到渲染结果：\n' + run.stdout.slice(0, 2000))
  process.exit(1)
}
const html = run.stdout.slice(marker + '__HTML__'.length)

const expectations: Array<[string, string]> = [
  ['uni-view', '内置组件 view 应渲染成 uni-view 元素'],
  ['uni-button', '内置组件 button 应渲染成 uni-button 元素'],
  ['uni-text', '内置组件 text 应渲染成 uni-text 元素'],
  ['uni-input', '内置组件 input 应渲染成 uni-input 元素'],
  ['添加', '首页「添加」按钮文案'],
  ['还没有待办', '首页空态文案'],
]
console.log('渲染出的 HTML 长度：' + html.length)
console.log(html.replace(/\s+/g, ' ').slice(0, 500) + ' …')
const missing = expectations.filter(([needle]) => !html.includes(needle))
if (missing.length > 0) {
  for (const [, reason] of missing) console.error('✗ ' + reason)
  process.exit(1)
}
console.log('✓ 渲染校验通过（' + projectId + ' 首页在预览运行时装下渲染出真实内容）')