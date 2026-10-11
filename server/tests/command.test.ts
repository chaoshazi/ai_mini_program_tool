// 命令白名单：只允许 npm/node/npx，参数里不许出现 shell 元字符。
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ApiError } from '../src/util/errors.js'
import { ALLOWED_COMMANDS, assertAllowed, runCommand, tokenize } from '../src/runtime/command.js'

const here = path.dirname(fileURLToPath(import.meta.url))

test('分词支持引号与空格', () => {
  assert.deepEqual(tokenize('npm run typecheck'), ['npm', 'run', 'typecheck'])
  assert.deepEqual(tokenize('node "a b.mjs"'), ['node', 'a b.mjs'])
  assert.throws(() => tokenize('npm "unclosed'))
})

test('白名单外的命令被拒绝', () => {
  for (const command of ['curl http://x', 'rm -rf /', 'bash -c ls', 'powershell Get-ChildItem', './node x.js', 'git status']) {
    assert.throws(
      () => assertAllowed(tokenize(command)),
      (error: unknown) => error instanceof ApiError && error.code === 42202,
      '应该拒绝：' + command,
    )
  }
})

test('白名单内命令通过，但元字符参数被拒绝', () => {
  for (const command of ALLOWED_COMMANDS) {
    assert.doesNotThrow(() => assertAllowed(tokenize(command + ' --version')))
  }
  for (const command of [
    'npm run typecheck && curl http://x',
    'npm run typecheck | tee /tmp/x',
    'node -e "require(\'fs\')"',
    'npm run build > out.txt',
    'node %TEMP%\\x.js',
  ]) {
    assert.throws(
      () => assertAllowed(tokenize(command)),
      (error: unknown) => error instanceof ApiError && error.code === 42202,
      '应该拒绝：' + command,
    )
  }
})

test('真实执行：node --version 成功，白名单外命令直接抛错', async () => {
  const result = await runCommand('node --version', { cwd: here, timeoutMs: 20_000, outputLimit: 1000 })
  assert.equal(result.ok, true)
  assert.match(result.stdout.trim(), /^v\d+\./)

  await assert.rejects(
    runCommand('curl http://example.com', { cwd: here, timeoutMs: 5_000, outputLimit: 1000 }),
    (error: unknown) => error instanceof ApiError && error.code === 42202,
  )
})