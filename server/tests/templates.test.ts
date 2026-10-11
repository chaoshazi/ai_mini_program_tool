// 模板占位符：清单、渲染、以及「渲染后不残留占位符」这条不变量。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { Workspace } from '../src/runtime/workspace.js'
import { findUnrenderedPlaceholders, PLACEHOLDERS, renderProject, renderString, templateRoot } from '../src/templates/index.js'

const SPEC = { appName: 'todo-app', appTitle: '待办清单', description: '示例工程', createdAt: '2026-01-01T00:00:00.000Z' }

test('renderString 替换占位符，未知占位符报错', () => {
  assert.equal(renderString('# {{appTitle}}\n', SPEC), '# 待办清单\n')
  assert.throws(() => renderString('{{unknownKey}}', SPEC), /模板占位符未提供取值/)
})

test('模板里用到的占位符都在清单里声明（Vue 插值 {{ from }} 不受影响）', () => {
  const root = templateRoot()
  assert.ok(fs.existsSync(root), '模板目录应该存在：' + root)
  const used = new Set<string>()
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(abs)
        continue
      }
      if (/\.(png|jpg|ico|woff2?)$/i.test(entry.name)) continue
      for (const name of findUnrenderedPlaceholders(fs.readFileSync(abs, 'utf8'))) used.add(name)
    }
  }
  walk(root)
  const declared = new Set(Object.keys(PLACEHOLDERS))
  for (const name of used) assert.ok(declared.has(name), '模板用了未声明的占位符：{{' + name + '}}')
  assert.ok(used.has('appName') && used.has('appTitle'), '模板至少应为工程名与应用名各留一个占位符')
})

test('渲染整个模板：关键文件齐全，且不留任何占位符', async () => {
  const varDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mw-tpl-'))
  const workspace = Workspace.ensure(varDir, 'render-check')
  const changes = await renderProject(workspace, SPEC)
  assert.ok(changes.length >= 30, '模板文件数量应该足够组成一个工程，实际 ' + changes.length)

  for (const expected of [
    'package.json',
    'README.md',
    'client/package.json',
    'client/src/main.ts',
    'client/src/pages.json',
    'client/src/pages/index/index.vue',
    'client/preview/vite.config.ts',
    'server/package.json',
    'server/src/index.ts',
    'scripts/dev.mjs',
  ]) {
    assert.ok(fs.existsSync(path.join(workspace.root, expected)), '缺少 ' + expected)
  }

  const rootPkg = JSON.parse(fs.readFileSync(path.join(workspace.root, 'package.json'), 'utf8')) as { name: string; type: string }
  assert.equal(rootPkg.name, 'todo-app')
  assert.equal(rootPkg.type, 'module')
  const pages = JSON.parse(fs.readFileSync(path.join(workspace.root, 'client/src/pages.json'), 'utf8')) as {
    pages: Array<{ path: string }>
    tabBar?: { list: Array<{ pagePath: string }> }
  }
  assert.ok(pages.pages.length >= 2, 'pages.json 至少注册两个页面')
  assert.ok((pages.tabBar?.list.length ?? 0) >= 2, 'tabBar 至少两个入口')

  // 不变量：渲染后不允许残留未替换的占位符
  const leftover: string[] = []
  for (const file of await workspace.listFiles(200)) {
    if (/\.(png|jpg|ico|woff2?)$/i.test(file.path)) continue
    const text = fs.readFileSync(path.join(workspace.root, file.path), 'utf8')
    for (const name of findUnrenderedPlaceholders(text)) leftover.push(file.path + ' -> {{' + name + '}}')
  }
  assert.deepEqual(leftover, [])

  // 每个注册的页面文件都必须真实存在（否则预览与真机都会 404）
  for (const page of pages.pages) {
    assert.ok(fs.existsSync(path.join(workspace.root, 'client/src', page.path + '.vue')), '缺少页面文件 ' + page.path)
  }
})