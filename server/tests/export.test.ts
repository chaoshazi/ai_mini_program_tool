// 导出：排除依赖与构建产物、必须带 README、文件名防穿越。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { assertSafeExportName, buildExport, collectEntries, exportFilename } from '../src/runtime/export.js'
import { Workspace } from '../src/runtime/workspace.js'
import { ApiError } from '../src/util/errors.js'

function tempWorkspace(): Workspace {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-export-'))
  return Workspace.ensure(dir, 'prj')
}

test('导出内容排除 node_modules 与构建产物', async () => {
  const workspace = tempWorkspace()
  await workspace.writeFile('README.md', '# demo\n')
  await workspace.writeFile('client/src/main.ts', 'export {}\n')
  await workspace.writeFile('client/node_modules/vue/index.js', 'module\n')
  await workspace.writeFile('client/dist-h5/index.html', '<html></html>\n')
  await workspace.writeFile('client/.env.local', 'VITE_API_BASE=/x\n')

  const names = (await collectEntries(workspace)).map((entry) => entry.name)
  assert.deepEqual([...names].sort(), ['README.md', 'client/src/main.ts'])
})

test('没有 README 时拒绝导出，导出文件名可预测', async () => {
  const workspace = tempWorkspace()
  await workspace.writeFile('client/src/main.ts', 'export {}\n')
  await assert.rejects(buildExport(workspace, 'x.zip'), (error: unknown) => error instanceof ApiError && /README/.test(error.message))

  assert.equal(exportFilename('todo-app', '2026-01-01'), 'todo-app-2026-01-01.zip')
  assert.equal(exportFilename('待办 清单/../x', '2026-01-01'), '待办-清单-..-x-2026-01-01.zip')
})

test('下载文件名只接受裸 zip 文件名', () => {
  assert.equal(assertSafeExportName('todo-app-1.zip'), 'todo-app-1.zip')
  for (const bad of ['../secret.zip', 'sub/dir.zip', 'x.txt', '', 'a/b/../c.zip']) {
    assert.throws(() => assertSafeExportName(bad), (error: unknown) => error instanceof ApiError && error.code === 40001, '应拒绝：' + bad)
  }
})