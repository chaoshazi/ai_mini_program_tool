// 存储：迁移、CRUD、文件索引。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Store } from '../src/store/db.js'
import type { Project } from '../src/store/types.js'

function tempStore(): Store {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-store-'))
  return new Store(path.join(dir, 'test.db'))
}

function makeProject(id: string): Project {
  return {
    id,
    name: '测试项目',
    description: '测试',
    status: 'draft',
    mode: 'offline',
    previewStatus: 'stopped',
    previewUrl: null,
    apiOrigin: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('迁移到最新版本且可重复打开', () => {
  const store = tempStore()
  assert.equal(store.schemaVersion(), 2)
  store.close()
  const reopened = new Store(store.dbPath)
  assert.equal(reopened.schemaVersion(), 2)
  reopened.close()
})

test('项目 / 消息 / 运行记录 CRUD', () => {
  const store = tempStore()
  store.createProject(makeProject('prj_1'))
  assert.equal(store.listProjects().length, 1)
  assert.equal(store.getProject('prj_1')?.name, '测试项目')

  store.updateProject('prj_1', { status: 'ready', previewStatus: 'running', previewUrl: '/preview/prj_1/' })
  assert.equal(store.getProject('prj_1')?.previewUrl, '/preview/prj_1/')

  store.addMessage({
    id: 'msg_1',
    projectId: 'prj_1',
    role: 'user',
    content: '做一个待办清单',
    runId: 'run_1',
    createdAt: '2026-01-01T00:00:01.000Z',
  })
  assert.equal(store.listMessages('prj_1').length, 1)

  store.createRun({
    id: 'run_1',
    projectId: 'prj_1',
    status: 'running',
    mode: 'offline',
    summary: '',
    files: [],
    build: null,
    error: null,
    startedAt: '2026-01-01T00:00:01.000Z',
    finishedAt: null,
  })
  store.finishRun('run_1', {
    status: 'succeeded',
    summary: '完成',
    files: [{ path: 'client/src/main.ts', action: 'create', bytes: 10 }],
    build: { ok: true, attempt: 0, checks: [], installed: true },
  })
  const run = store.getRun('run_1')
  assert.equal(run?.status, 'succeeded')
  assert.equal(run?.files.length, 1)
  assert.equal(run?.build?.installed, true)

  store.replaceFileIndex('prj_1', [{ path: 'client/src/main.ts', size: 10, hash: 'abc' }])
  assert.deepEqual(store.listFileIndex('prj_1'), [{ path: 'client/src/main.ts', size: 10, hash: 'abc' }])

  // 删除项目要级联清掉消息 / 运行记录 / 文件索引
  assert.equal(store.deleteProject('prj_1'), true)
  assert.equal(store.listProjects().length, 0)
  assert.equal(store.listMessages('prj_1').length, 0)
  assert.equal(store.getRun('run_1'), null)
  assert.equal(store.listFileIndex('prj_1').length, 0)
  store.close()
})
test('外部后端地址（apiOrigin）能存能改能清空', () => {
  const store = tempStore()
  store.createProject(makeProject('prj_api'))
  assert.equal(store.getProject('prj_api')?.apiOrigin, null)

  const updated = store.updateProject('prj_api', { apiOrigin: 'http://127.0.0.1:8081' })
  assert.equal(updated?.apiOrigin, 'http://127.0.0.1:8081')
  assert.equal(store.getProject('prj_api')?.apiOrigin, 'http://127.0.0.1:8081')

  store.updateProject('prj_api', { apiOrigin: null })
  assert.equal(store.getProject('prj_api')?.apiOrigin, null)
  store.close()
})
