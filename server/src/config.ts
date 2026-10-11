// 工具自身的运行配置：环境变量优先，其次读仓库根的 .env（.env 不进版本库）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..')

/** 极简 .env 解析：KEY=VALUE，支持 # 注释与两端引号，不覆盖已存在的进程环境变量。 */
function loadDotEnv(): void {
  const file = path.join(REPO_ROOT, '.env')
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function str(name: string, fallback: string): string {
  const raw = process.env[name]
  return raw === undefined || raw === '' ? fallback : raw
}

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxTokens: number
  /** 无 Key 时为 false，生成链路降级为离线脚手架模式。 */
  enabled: boolean
}

export interface AppConfig {
  port: number
  host: string
  varDir: string
  workspacesDir: string
  logsDir: string
  dbPath: string
  webDistDir: string
  /** 生成后再校验失败时的自动回灌重试次数上限。 */
  maxBuildRetries: number
  /** run_command 单次执行超时。 */
  commandTimeoutMs: number
  /** 单条命令输出截断长度（字符）。 */
  commandOutputLimit: number
  /** 同时运行的预览数上限（也是端口槽位上限）。 */
  previewConcurrency: number
  /** 预览端口起点：client = base + slot*2，server = base + slot*2 + 1。 */
  previewPortBase: number
  llm: LlmConfig
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  loadDotEnv()
  const varDir = path.resolve(REPO_ROOT, str('MW_VAR_DIR', 'var'))
  const llm: LlmConfig = {
    baseUrl: str('LLM_BASE_URL', 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    apiKey: str('LLM_API_KEY', ''),
    model: str('LLM_MODEL', 'deepseek-chat'),
    timeoutMs: num('LLM_TIMEOUT_MS', 120_000),
    maxTokens: num('LLM_MAX_TOKENS', 8000),
    enabled: false,
  }
  llm.enabled = llm.apiKey.length > 0
  return {
    port: num('MW_SERVER_PORT', 9320),
    host: str('MW_SERVER_HOST', '127.0.0.1'),
    varDir,
    workspacesDir: path.join(varDir, 'workspaces'),
    logsDir: path.join(varDir, 'logs'),
    dbPath: path.join(varDir, 'miniwechat.db'),
    webDistDir: path.join(REPO_ROOT, 'web', 'dist'),
    maxBuildRetries: num('MW_BUILD_RETRIES', 2),
    commandTimeoutMs: num('MW_COMMAND_TIMEOUT_MS', 240_000),
    commandOutputLimit: num('MW_COMMAND_OUTPUT_LIMIT', 8000),
    previewConcurrency: num('MW_PREVIEW_CONCURRENCY', 4),
    previewPortBase: num('MW_PREVIEW_PORT_BASE', 9400),
    llm,
    ...overrides,
  }
}