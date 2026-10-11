// 模板冒烟：渲染示例工程 -> npm install -> typecheck -> H5 构建。
// 用法：npm run smoke [-- <projectId>] [-- --fresh]
import { loadConfig } from '../src/config.js'
import { Builder } from '../src/runtime/build.js'
import { Workspace } from '../src/runtime/workspace.js'
import { renderProject } from '../src/templates/index.js'
import { Logger } from '../src/util/logger.js'

const args = process.argv.slice(2)
const projectId = args.find((arg) => !arg.startsWith('--')) ?? 'smoke-template'
const config = loadConfig()
const logger = new Logger('smoke', config.logsDir)
const workspace = Workspace.ensure(config.workspacesDir, projectId)
if (args.includes('--fresh')) await workspace.wipe()

const started = Date.now()
const changes = await renderProject(workspace, {
  appName: 'todo-demo',
  appTitle: '待办清单',
  description: 'miniwechat 模板冒烟示例工程',
})
console.log('渲染文件数：' + changes.length + '，工作目录：' + workspace.root)

const builder = new Builder({ config, workspace, logger })
const deps = await builder.ensureDeps()
console.log('依赖安装：' + (deps.ok ? 'OK' : '失败') + (deps.installed ? '（本次安装）' : '（已存在，跳过）'))
if (!deps.ok) {
  console.error(deps.output)
  process.exit(1)
}

const report = await builder.verify(1, deps.installed)
for (const check of report.checks) {
  console.log((check.ok ? 'PASS' : 'FAIL') + ' ' + check.name + ' (' + check.durationMs + 'ms)')
  for (const error of check.errors) console.log('  - ' + error)
}
console.log('总耗时 ' + Math.round((Date.now() - started) / 1000) + 's，构建' + (report.ok ? '通过' : '失败'))
process.exit(report.ok ? 0 : 1)