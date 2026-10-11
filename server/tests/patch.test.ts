// 补丁解析与应用：模型最常用的改文件方式，必须给出可读错误。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '../src/util/errors.js'
import { applyBlock, parsePatch } from '../src/runtime/patch.js'

const UPDATE = [
  '*** Update File: client/src/pages/index/index.vue',
  '<<<<<<< SEARCH',
  'const a = 1',
  '=======',
  'const a = 2',
  '>>>>>>> REPLACE',
  '',
].join('\n')

test('解析 Update / Add / Delete 三种段', () => {
  const patch = [
    UPDATE,
    '*** Add File: client/src/pages/new/new.vue',
    '<template><view>hi</view></template>',
    '*** Delete File: client/src/pages/old/old.vue',
  ].join('\n')
  const ops = parsePatch(patch)
  assert.equal(ops.length, 3)
  assert.deepEqual(ops[0], {
    kind: 'update',
    path: 'client/src/pages/index/index.vue',
    blocks: [{ search: 'const a = 1', replace: 'const a = 2' }],
  })
  assert.deepEqual(ops[1], { kind: 'add', path: 'client/src/pages/new/new.vue', content: '<template><view>hi</view></template>' })
  assert.deepEqual(ops[2], { kind: 'delete', path: 'client/src/pages/old/old.vue' })
})

test('一个文件多块补丁按顺序应用', () => {
  const patch = [
    '*** Update File: a.ts',
    '<<<<<<< SEARCH',
    'x',
    '=======',
    'y',
    '>>>>>>> REPLACE',
    '<<<<<<< SEARCH',
    'z',
    '=======',
    'w',
    '>>>>>>> REPLACE',
  ].join('\n')
  const ops = parsePatch(patch)
  const first = ops[0]
  assert.ok(first && first.kind === 'update')
  assert.equal(first.blocks.length, 2)
  let content = 'x\nz'
  for (const block of first.blocks) content = applyBlock('a.ts', content, block)
  assert.equal(content, 'y\nw')
})

test('畸形补丁报可读错误', () => {
  assert.throws(() => parsePatch('随便写点东西'), (error: unknown) => error instanceof ApiError && error.code === 40001)
  assert.throws(
    () => parsePatch('*** Update File: a.ts\n没有搜索块'),
    (error: unknown) => error instanceof ApiError && /SEARCH/.test(error.message),
  )
})

test('applyBlock：找不到或多处命中都要明确报错', () => {
  assert.equal(applyBlock('a.ts', 'line1\nline2', { search: 'line1', replace: 'L1' }), 'L1\nline2')
  assert.throws(
    () => applyBlock('a.ts', 'abc', { search: 'zzz', replace: 'x' }),
    (error: unknown) => error instanceof ApiError && /找不到 SEARCH/.test(error.message),
  )
  assert.throws(
    () => applyBlock('a.ts', 'dup\ndup', { search: 'dup', replace: 'x' }),
    (error: unknown) => error instanceof ApiError && /出现多次/.test(error.message),
  )
})