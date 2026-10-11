import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diffIndex } from '../src/agent/diff.js'

test('对比两轮文件索引得出变更清单', () => {
  const before = [
    { path: 'client/src/pages.json', size: 10, hash: 'a' },
    { path: 'client/src/pages/index/index.vue', size: 20, hash: 'b' },
  ]
  const after = [
    { path: 'client/src/pages.json', size: 12, hash: 'a2' },
    { path: 'client/src/pages/index/index.vue', size: 20, hash: 'b' },
    { path: 'server/src/routes.ts', size: 33, hash: 'c' },
  ]
  const changes = diffIndex(before, after)
  assert.deepEqual(changes, [
    { path: 'client/src/pages.json', action: 'update', bytes: 12 },
    { path: 'server/src/routes.ts', action: 'create', bytes: 33 },
  ])

  const removed = diffIndex(after, [after[0]!])
  assert.deepEqual(removed, [
    { path: 'client/src/pages/index/index.vue', action: 'delete', bytes: 0 },
    { path: 'server/src/routes.ts', action: 'delete', bytes: 0 },
  ])
})