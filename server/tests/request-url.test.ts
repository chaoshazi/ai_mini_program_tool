// 预览运行时的请求地址拼接必须幂等：调用方已经拼过 VITE_API_BASE 时不能再拼一次。
import fs from 'node:fs'
// 这个坑真实发生过：拼成两遍前缀后代理认不出 /api，请求被转给 vite 拿回 index.html，
// 页面 JSON.parse 失败后把整段 HTML 当字符串遍历，渲染出几百个空行。
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolveRequestUrl } from '../src/templates/project/client/preview/request-url.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

test('resolveRequestUrl：调用方拼过前缀就不再拼，没拼过才补上', () => {
  const base = '/preview/prj_abc'
  // 调用方（request.ts）已经把前缀拼好了 —— 必须原样返回
  assert.equal(resolveRequestUrl('/preview/prj_abc/api/departments', base), '/preview/prj_abc/api/departments')
  // 只给了 /api/xxx —— 需要补上前缀
  assert.equal(resolveRequestUrl('/api/departments', base), '/preview/prj_abc/api/departments')
  assert.equal(resolveRequestUrl('api/departments', base), '/preview/prj_abc/api/departments')
  // 绝对地址不动
  assert.equal(resolveRequestUrl('https://api.example.com/api/x', base), 'https://api.example.com/api/x')
  // 没有前缀时保持原样（自己跑 npm run dev 的情况）
  assert.equal(resolveRequestUrl('/api/x', ''), '/api/x')
  // 前缀带结尾斜杠也认得出来
  assert.equal(resolveRequestUrl('/preview/prj_abc/api/x', base + '/'), '/preview/prj_abc/api/x')
})

test('反复拼接不会越拼越长（幂等）', () => {
  const base = '/preview/prj_abc'
  let url = '/api/appointments'
  for (let i = 0; i < 3; i += 1) url = resolveRequestUrl(url, base)
  assert.equal(url, '/preview/prj_abc/api/appointments')
})

test('模板的 shim 必须用幂等拼接，请求封装必须拒绝非 JSON 响应', () => {
  const shim = fs.readFileSync(path.join(repoRoot, 'server/src/templates/project/client/preview/uni-shim.ts'), 'utf8')
  assert.ok(shim.includes('resolveRequestUrl(options.url'), 'shim 必须用 resolveRequestUrl 拼地址')
  assert.ok(!shim.includes('base + options.url'), 'shim 不能再无条件拼前缀')

  const requestTs = fs.readFileSync(path.join(repoRoot, 'server/src/templates/project/client/src/api/request.ts'), 'utf8')
  assert.ok(requestTs.includes('没返回 JSON'), '请求封装必须对非 JSON 响应报错，而不是把它当数据返回')
})
