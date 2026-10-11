// 对外契约：错误码、SSE 事件名集合、以及 web 侧类型与 schemas.ts 同步。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createEmitter } from '../src/agent/events.js'
import { SSE_EVENT_NAMES, type SseEventMap, type SseEventName } from '../src/api/schemas.js'
import { generateWebTypes } from '../scripts/gen-web-types.js'
import { ApiCode, ApiError, messageForCode } from '../src/util/errors.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('SSE 事件名与事件体类型一一对应', () => {
  // 编译期检查：SseEventMap 必须覆盖 SSE_EVENT_NAMES 里的每一项（少了会在这里报错）
  const covered: Record<SseEventName, keyof SseEventMap> = {
    plan: 'plan',
    tool: 'tool',
    file: 'file',
    build: 'build',
    preview: 'preview',
    delta: 'delta',
    done: 'done',
    error: 'error',
  }
  assert.deepEqual(Object.keys(covered).sort(), [...SSE_EVENT_NAMES].sort())
})

test('事件帧是 event + data 的标准 SSE 格式，且带上 runId', () => {
  const frames: Array<{ event: string; data: string }> = []
  const emit = createEmitter('run_1', (frame) => frames.push(frame))
  emit('plan', { summary: '开始', steps: ['a'], mode: 'offline' })
  emit('file', { path: 'client/src/main.ts', action: 'create', bytes: 3 })
  emit('error', { code: ApiCode.BUILD_FAILED, message: '构建失败', detail: null })

  assert.deepEqual(emit.sent, ['plan', 'file', 'error'])
  assert.equal(frames.length, 3)
  for (const frame of frames) {
    const parsed = JSON.parse(frame.data) as { type: string; runId: string; at: string }
    assert.equal(parsed.type, frame.event)
    assert.equal(parsed.runId, 'run_1')
    assert.ok(!Number.isNaN(Date.parse(parsed.at)))
  }
  assert.throws(() => (emit as unknown as (t: string, d: unknown) => void)('nope', {}), /未知 SSE 事件类型/)
})

test('错误码与默认文案成对出现', () => {
  for (const code of Object.values(ApiCode)) {
    assert.equal(typeof messageForCode(code), 'string')
    assert.ok(messageForCode(code).length > 0)
  }
  const error = ApiError.pathViolation('越界了')
  assert.equal(error.code, 42201)
  assert.equal(error.status, 403)
  assert.equal(error.message, '越界了')
})

test('web/src/api/types.ts 与 schemas.ts 保持同步（改完要跑 npm run gen:types）', () => {
  const target = path.join(repoRoot, 'web', 'src', 'api', 'types.ts')
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : ''
  const expected = generateWebTypes()
  assert.equal(current, expected, 'web 类型与 schemas.ts 不一致，请运行 npm run gen:types')
})