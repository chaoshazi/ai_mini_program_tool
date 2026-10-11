// 生成后的校验闭环：装依赖 -> typecheck -> H5 构建；失败时产出可回灌给模型的错误摘要。
import fs from 'node:fs'
import path from 'node:path'
import type { AppConfig } from '../config.js'
import type { BuildCheck, BuildReport } from '../store/types.js'
import { Logger } from '../util/logger.js'
import { spawnTokens } from './command.js'
import type { Workspace } from './workspace.js'

export interface BuilderDeps {
  config: AppConfig
  workspace: Workspace
  logger: Logger
}

function extractErrors(output: string): string[] {
  const lines = output.split('\n').map((line) => line.trimEnd())
  const hits = lines.filter((line) =>
    /(^|\s)error(\s+TS\d+)?:|^error\b|✗|failed|Cannot find module|is not defined|npm ERR!/i.test(line),
  )
  const trimmed = hits.map((line) => line.trim()).filter((line) => line.length > 0)
  return Array.from(new Set(trimmed)).slice(0, 25)
}

export class Builder {
  constructor(private readonly deps: BuilderDeps) {}

  private get workspace(): Workspace {
    return this.deps.workspace
  }

  /** 取工程内的绝对路径；不传参数时返回工程根目录。 */
  private dir(...parts: string[]): string {
    if (parts.length === 0) return this.workspace.root
    return this.workspace.resolve(parts.join('/'))
  }

  /** 依赖没装过就在生成工程根目录跑一次 npm install（workspaces 会一起装 client 与 server）。 */
  async ensureDeps(): Promise<{ installed: boolean; ok: boolean; output: string }> {
    const hasServer = fs.existsSync(this.dir('server', 'package.json'))
    const marker = hasServer ? this.dir('node_modules') : this.dir('client', 'node_modules')
    const clientMarker = this.dir('client', 'node_modules')
    if (fs.existsSync(marker) && fs.existsSync(clientMarker)) {
      return { installed: false, ok: true, output: '依赖已存在，跳过安装' }
    }
    this.deps.logger.info('生成工程缺少依赖，开始 npm install', { projectId: this.workspace.projectId })
    const result = await spawnTokens(['npm', 'install', '--no-audit', '--no-fund', '--loglevel', 'error'], {
      cwd: hasServer ? this.dir() : this.dir('client'),
      timeoutMs: Math.max(this.deps.config.commandTimeoutMs, 600_000),
      outputLimit: 4000,
    }).done
    return { installed: true, ok: result.ok, output: (result.stdout + '\n' + result.stderr).trim() }
  }

  /** 依次跑 client typecheck / server typecheck / client H5 构建。 */
  async verify(attempt: number, installed: boolean): Promise<BuildReport> {
    const checks: BuildCheck[] = []
    const plan: Array<{ name: string; cwd: string; tokens: string[] }> = [
      { name: 'client:typecheck', cwd: this.dir('client'), tokens: ['npm', 'run', 'typecheck'] },
      { name: 'server:typecheck', cwd: this.dir('server'), tokens: ['npm', 'run', 'typecheck'] },
      { name: 'client:build-h5', cwd: this.dir('client'), tokens: ['npm', 'run', 'build:h5'] },
    ]
    for (const step of plan) {
      if (!fs.existsSync(step.cwd)) {
        checks.push({
          name: step.name,
          command: step.tokens.join(' '),
          ok: false,
          exitCode: null,
          durationMs: 0,
          errors: ['目录不存在：' + path.relative(this.workspace.root, step.cwd).replace(/\\/g, '/')],
          output: '',
        })
        continue
      }
      const started = Date.now()
      const result = await spawnTokens(step.tokens, {
        cwd: step.cwd,
        timeoutMs: this.deps.config.commandTimeoutMs,
        outputLimit: this.deps.config.commandOutputLimit,
      }).done
      const output = (result.stdout + '\n' + result.stderr).trim()
      checks.push({
        name: step.name,
        command: step.tokens.join(' '),
        ok: result.ok,
        exitCode: result.exitCode,
        durationMs: Date.now() - started,
        errors: result.ok ? [] : extractErrors(output),
        output: output.slice(-4000),
      })
      if (!result.ok) break
    }
    return { ok: checks.every((check) => check.ok), attempt, checks, installed }
  }

  /** 把构建失败信息压成一段可读文本，作为下一轮对话的输入。 */
  static summarize(report: BuildReport): string {
    const failed = report.checks.filter((check) => !check.ok)
    if (failed.length === 0) return '构建校验通过'
    const parts = failed.map((check) => {
      const errs = check.errors.length > 0 ? check.errors.join('\n') : check.output.split('\n').slice(-15).join('\n')
      return '【' + check.name + '】命令 `' + check.command + '` 失败（exit=' + check.exitCode + '）\n' + errs
    })
    return parts.join('\n\n')
  }
}
