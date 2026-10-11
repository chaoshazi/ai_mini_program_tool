// 沙箱不变量：生成代码只能落在工作目录里。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { ApiError } from '../src/util/errors.js'
import { IGNORED_DIRS, normalizeRelPath, resolveInside } from '../src/runtime/paths.js'

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-paths-'))
  return fs.realpathSync(root)
}

test('正常相对路径解析到工作目录内', () => {
  const root = tempRoot()
  assert.equal(resolveInside(root, 'client/src/main.ts'), path.join(root, 'client', 'src', 'main.ts'))
  assert.equal(resolveInside(root, './a/b.txt'), path.join(root, 'a', 'b.txt'))
  assert.equal(resolveInside(root, 'a\\b.txt'), path.join(root, 'a', 'b.txt'))
})

test('拒绝越界与非法路径', () => {
  const root = tempRoot()
  const cases = ['', '   ', '../x', 'a/../../x', '/etc/passwd', 'C:/Windows', 'c:\\temp\\x', 'a\u0000b', '~/.ssh/config']
  for (const item of cases) {
    assert.throws(
      () => resolveInside(root, item),
      (error: unknown) => error instanceof ApiError && error.code === 42201,
      '应该拒绝：' + JSON.stringify(item),
    )
  }
})

test('跟随符号链接逃出工作目录会被拒绝', () => {
  const root = tempRoot()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret', 'utf8')
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'dir')
  } catch {
    return // Windows 无符号链接权限时跳过
  }
  assert.throws(() => resolveInside(root, 'link/secret.txt'), (error: unknown) => error instanceof ApiError && error.code === 42201)
})

test('路径归一化与忽略目录常量', () => {
  assert.equal(normalizeRelPath('.\\client\\a.ts'), 'client/a.ts')
  assert.equal(normalizeRelPath('./x/y'), 'x/y')
  for (const dir of ['node_modules', '.git', 'dist', 'dist-h5']) {
    assert.ok(IGNORED_DIRS.has(dir), dir + ' 应该在忽略列表里')
  }
})