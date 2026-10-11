// 工具后端入口：加载配置 -> 迁移数据库 -> 挂路由 -> 监听 9320。
// 启动方式见 package.json：用 node --disable-warning=ExperimentalWarning --import tsx 起服务，
// 这样 node:sqlite 的实验特性告警不会刷屏，其它告警照常可见。
import fs from 'node:fs'
import { loadConfig } from './config.js'
import { buildApp } from './app.js'
import { Store } from './store/db.js'
import { PreviewManager } from './runtime/preview.js'
import { previewPortRange, reclaimPreviewPorts, reclaimWorkspaceProcesses } from './runtime/reclaim.js'
import { Logger } from './util/logger.js'

const config = loadConfig()
for (const dir of [config.varDir, config.workspacesDir, config.logsDir]) {
  fs.mkdirSync(dir, { recursive: true })
}

const logger = new Logger('server', config.logsDir)
const store = new Store(config.dbPath)
const previews = new PreviewManager(config, store, logger)
const app = buildApp({ config, store, previews, logger })

logger.info('启动 miniwechat 工具后端', {
  port: config.port,
  schemaVersion: store.schemaVersion(),
  llm: config.llm.enabled ? config.llm.model : '未配置（离线脚手架模式）',
  varDir: config.varDir,
})

async function shutdown(signal: string): Promise<void> {
  logger.info('收到 ' + signal + '，正在停止预览进程并关闭服务')
  await previews.stopAll().catch(() => undefined)
  await app.close().catch(() => undefined)
  store.close()
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal)
  })
}

// 工具可能被 tsx watch 重启过：先把上次预览遗留、还占着端口的孤儿进程收掉。
const reclaimed = await reclaimPreviewPorts(previewPortRange(config.previewPortBase, config.previewConcurrency), logger)
for (const item of reclaimed.filter((entry) => entry.killed)) {
  logger.warn('启动时回收了上次预览残留的进程', { port: item.port, pid: item.pid, name: item.name })
}
// 端口扫描看不到"只占着目录、没在监听"的 npm/tsx 监督进程，这里按命令行再扫一遍工作区。
const orphans = await reclaimWorkspaceProcesses(config.workspacesDir, logger)
if (orphans > 0) {
  logger.warn('启动时清理了工作区里的残留进程', { count: orphans })
}

await app.listen({ port: config.port, host: config.host })
logger.info('控制台 API 就绪：http://' + config.host + ':' + config.port + '/api/health')
if (!config.llm.enabled) {
  logger.warn('未配置 LLM_API_KEY：生成链路会走离线脚手架模式（见 .env.example）')
}