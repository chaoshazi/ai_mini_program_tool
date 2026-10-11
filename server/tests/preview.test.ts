// 预览启动守卫：工作区还没生成内容时（新建后没生成、或 var/ 被清过）必须给可执行的提示，
// 而不是让 fs 抛 ENOENT 变成一个看不懂的 500，也不该占用端口槽位、把项目状态改成 error。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config.js'
import { assertGeneratedProject, previewEnv, PreviewManager } from '../src/runtime/preview.js'
import { resolveTarget } from '../src/api/proxy.js'
import { Workspace } from '../src/runtime/workspace.js'
import { Store } from '../src/store/db.js'
import { ApiCode, ApiError } from '../src/util/errors.js'
import { newId, nowIso } from '../src/util/ids.js'
import { Logger } from '../src/util/logger.js'

function makeRig(): { previews: PreviewManager; store: Store; projectId: string } {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-preview-'))
  const config = loadConfig({
    varDir,
    workspacesDir: path.join(varDir, 'workspaces'),
    logsDir: path.join(varDir, 'logs'),
    dbPath: path.join(varDir, 'preview.db'),
  })
  const store = new Store(config.dbPath)
  const projectId = newId('prj')
  const now = nowIso()
  store.createProject({
    id: projectId,
    name: '预览守卫用例',
    description: '',
    status: 'draft',
    mode: 'offline',
    previewStatus: 'stopped',
    previewUrl: null,
    apiOrigin: null,
    createdAt: now,
    updatedAt: now,
  })
  return { previews: new PreviewManager(config, store, new Logger('preview-test')), store, projectId }
}

test('工作区为空时启动预览：给可执行提示，且不占端口槽位、不改项目状态', async () => {
  const { previews, store, projectId } = makeRig()

  await assert.rejects(
    () => previews.start(projectId),
    (error: unknown) => {
      assert.ok(error instanceof ApiError, '应抛出 ApiError 而不是原始 fs 错误')
      assert.equal(error.code, ApiCode.BAD_REQUEST)
      assert.match(error.message, /还没有生成工程文件/)
      assert.match(error.message, /client\/package\.json/)
      return true
    },
  )

  assert.equal(previews.list().length, 0, '失败后不应残留预览条目')
  assert.equal(store.getProject(projectId)?.previewStatus, 'stopped', '失败不应把项目状态改成 error')
})

test('工作区里已经有 client/ 与 server/ 工程时守卫放行', () => {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-preview-ok-'))
  const workspace = Workspace.ensure(varDir, 'p-ok')
  assert.throws(() => assertGeneratedProject(workspace), /还没有生成工程文件/)

  for (const rel of ['client/package.json', 'server/package.json']) {
    const abs = path.join(workspace.root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, '{}\n', 'utf8')
  }
  assert.doesNotThrow(() => assertGeneratedProject(workspace))
})
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('预览注入的前缀不含 /api：拼出来的接口地址只有一个 /api', () => {
  const env = previewEnv('prj_abc')
  const lines = env.trimEnd().split('\n')
  assert.deepEqual(lines, ['VITE_API_BASE=/preview/prj_abc', 'MW_PREVIEW_BASE=/preview/prj_abc/'])

  const base = lines[0].slice('VITE_API_BASE='.length)
  assert.equal(base + '/api/departments', '/preview/prj_abc/api/departments')
  assert.equal(base + '/api/health', '/preview/prj_abc/api/health')
  assert.ok(!base.endsWith('/api'), '前缀里不能再带 /api，否则会拼成 /api/api')
  assert.ok(!base.endsWith('/'), '前缀不能有结尾斜杠，否则会拼出双斜杠')
})

test('模板里没有把 /api 写进注入前缀的写法，且接口路径统一以 /api/ 开头', () => {
  const templateDir = path.join(repoRoot, 'server', 'src', 'templates', 'project')
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (/\.(ts|vue|json|md|mjs|js)$/.test(entry.name)) files.push(abs)
    }
  }
  walk(templateDir)
  assert.ok(files.length > 20, '模板文件读取异常，只扫到 ' + files.length + ' 个')

  for (const templateFile of files) {
    const rel = path.relative(templateDir, templateFile).replace(/\\/g, '/')
    // 只看代码，注释里出现示例不算数
    const source = fs
      .readFileSync(templateFile, 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n')
    assert.ok(!source.includes('/preview/<id>/api'), rel + '：注入前缀不能带 /api')
    assert.ok(!source.includes('/preview/<projectId>/api'), rel + '：注入前缀不能带 /api')
    for (const match of source.matchAll(/api\.(?:get|post|patch|del)(?:<[^>]*>)?\('([^']+)'/g)) {
      assert.ok(match[1].startsWith('/api/'), rel + '：接口路径必须以 /api/ 开头，实际 ' + match[1])
    }
  }
})

test('项目指定外部后端时：只要求页面工程存在，且 /api 请求被路由到外部后端', () => {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-preview-ext-'))
  const workspace = Workspace.ensure(varDir, 'p-ext')
  fs.mkdirSync(path.join(workspace.root, 'client'), { recursive: true })
  fs.writeFileSync(path.join(workspace.root, 'client', 'package.json'), '{}\n', 'utf8')

  // 没有 server/ 也能过守卫（外部后端项目的正常形态）
  assert.doesNotThrow(() => assertGeneratedProject(workspace, { requireApi: false }))
  assert.throws(() => assertGeneratedProject(workspace), /还没有生成工程文件/)

  // /preview/<id>/api/... 走外部后端；其它路径仍然走页面 dev server
  const targets = { clientOrigin: 'http://127.0.0.1:9400', apiOrigin: 'http://127.0.0.1:8081' }
  assert.deepEqual(resolveTarget('/preview/prj_x/api/departments', targets), {
    origin: 'http://127.0.0.1:8081',
    pathWithQuery: '/api/departments',
  })
  assert.deepEqual(resolveTarget('/preview/prj_x/api/doctors?departmentId=1', targets), {
    origin: 'http://127.0.0.1:8081',
    pathWithQuery: '/api/doctors?departmentId=1',
  })
  assert.equal(resolveTarget('/preview/prj_x/', targets).origin, 'http://127.0.0.1:9400')
  assert.equal(resolveTarget('/preview/prj_x/@vite/client', targets).origin, 'http://127.0.0.1:9400')
})
