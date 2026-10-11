// 真浏览器检查：拿系统自带的 Edge/Chrome 无头模式把页面渲染出来，断言 DOM 里确实有东西 .
// SSR 渲染、接口探活、模块能不能编译，这三样都发现不了"页面里其实没数据/渲染出几百个空行"这类问题，
// 这个脚本能（它就是被一次真实事故逼出来的）.
//
// 用法：
//   npm run check:browser -- <projectId|URL> [期望出现的内容 ...]
//   例：npm run check:browser -- prj_abc 内科学系
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { loadConfig } from '../src/config.js'

const run = promisify(execFile)
const args = process.argv.slice(2)

function argValue(name: string): string | null {
  const withEquals = args.find((arg) => arg.startsWith(name + '='))
  if (withEquals) return withEquals.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}

// 位置式参数：第一个非 -- 参数是 projectId 或完整 URL，其余都是"期望出现的内容" .
// （npm 会把 --project 这类 flag 当成它自己的配置吃掉，所以不依赖它们，仍兼容 --project=X 写法）
const flagProject = argValue("--project")
const flagUrl = argValue("--url")
const positional = args.filter((arg) => !arg.startsWith("--") && arg !== flagProject && arg !== flagUrl)
const head = flagProject === null && flagUrl === null ? positional.shift() ?? "" : ""
const headIsUrl = /^https?:\/\//i.test(head)

const config = loadConfig()
const projectId = flagProject ?? (head === "" || headIsUrl ? "smoke-template" : head)
const url = flagUrl ?? (headIsUrl ? head : 'http://127.0.0.1:' + config.port + '/preview/' + projectId + '/')
const expectations = positional

const CANDIDATES = [
  process.env.MW_BROWSER ?? '',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const browser = CANDIDATES.find((candidate) => candidate !== '' && fs.existsSync(candidate))
if (!browser) {
  console.error('找不到 Edge/Chrome，可用 MW_BROWSER 指定可执行文件路径')
  process.exit(1)
}

console.log('浏览器：' + browser)
console.log('地址：' + url)
const { stdout } = await run(
  browser,
  ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=9000', '--dump-dom', url],
  { maxBuffer: 32 * 1024 * 1024 },
)
const dom = stdout
const text = dom
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
console.log('DOM ' + dom.length + 'B，正文 ' + text.length + ' 字')
console.log('正文片段：' + text.slice(0, 200))

if (expectations.length === 0) {
  console.log('（没有给期望字符串，只做了渲染）')
  process.exit(0)
}

let failed = 0
for (const expected of expectations) {
  const hit = dom.includes(expected)
  console.log((hit ? '  OK  ' : '  缺失 ') + expected)
  if (!hit) failed += 1
}
if (failed > 0) {
  console.error('页面里没找到 ' + failed + ' 个期望内容')
  process.exit(1)
}
console.log('页面渲染检查通过')