// 用无头 Edge + CDP 截图：支持登录态（后台）、手机视口（小程序）、等数据渲染完再拍。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const OUT = 'D:/miniwechat/docs/screenshots'
const TOOL = 'http://127.0.0.1:9320'
const PREVIEW = TOOL + '/preview/prj_1m4mzwxyj29gangb'
const ADMIN = 'http://127.0.0.1:8082'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 后台登录态：先用 fetch 登一次，拿 laravel_session 丢给浏览器
async function adminCookie() {
  const page = await fetch(ADMIN + '/admin/login')
  const cookies = page.headers.getSetCookie().map((c) => c.split(';')[0])
  const jar = cookies.join('; ')
  const token = /name="_token" value="([^"]+)"/.exec(await page.text())[1]
  const res = await fetch(ADMIN + '/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({ _token: token, username: 'admin', password: 'admin123' }).toString(),
    redirect: 'manual',
  })
  const all = [...cookies, ...res.headers.getSetCookie().map((c) => c.split(';')[0])]
  const session = all.map((c) => c.split('=')).find(([k]) => k === 'laravel_session')
  if (!session) throw new Error('没拿到后台会话 cookie')
  return session.join('=')
}

const cookie = await adminCookie()
console.log('后台登录态: ' + cookie.slice(0, 30) + '...')

const tasks = [
  { name: '01-console-projects', url: TOOL + '/', w: 1440, h: 1000, waitFor: '项目' },
  { name: '02-console-workspace', url: TOOL + '/', w: 1440, h: 1000, clickText: '购物商城系统', waitFor: '购物商城系统', settle: 5000 },
  { name: '03-mp-home', url: PREVIEW + '/', w: 430, h: 1180, mobile: true, waitFor: '购物商城' },
  { name: '04-mp-goods-list', url: PREVIEW + '/pages/goods-list/goods-list?id=9', w: 430, h: 1180, mobile: true, waitFor: '冠益乳' },
  { name: '05-mp-goods-detail', url: PREVIEW + '/pages/goods-detail/goods-detail?id=64', w: 430, h: 1180, mobile: true, waitFor: '购买数量' },
  { name: '06-mp-category', url: PREVIEW + '/pages/category/category', w: 430, h: 1180, mobile: true, waitFor: '商品分类' },
  { name: '07-mp-user', url: PREVIEW + '/pages/user/user', w: 430, h: 1180, mobile: true, waitFor: '个人中心' },
  { name: '08-admin-login', url: ADMIN + '/admin/login', w: 1440, h: 900, waitFor: '商城后台登录' },
  { name: '09-admin-dashboard', url: ADMIN + '/admin', w: 1440, h: 1100, waitFor: '累计成交' },
  { name: '10-admin-goods', url: ADMIN + '/admin/goods', w: 1440, h: 1300, waitFor: '商品列表' },
  { name: '11-admin-orders', url: ADMIN + '/admin/orders', w: 1440, h: 900, waitFor: '订单列表' },
  { name: '12-admin-categories', url: ADMIN + '/admin/categories', w: 1440, h: 1000, waitFor: '分类列表' },
]

const userDataDir = path.join(os.tmpdir(), 'mw-edge-shot-' + Date.now())
const edge = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir, 'about:blank',
], { stdio: 'ignore' })

let version = null
for (let i = 0; i < 40 && !version; i++) {
  await sleep(500)
  try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json() } catch { /* 还没起来 */ }
}
if (!version) throw new Error('Edge 没起来')

const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let nextId = 1
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  }
}
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)

fs.mkdirSync(OUT, { recursive: true })
const shot = async (task) => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: task.w, height: task.h, deviceScaleFactor: task.mobile ? 2 : 1, mobile: Boolean(task.mobile),
  }, sessionId)
  await send('Network.enable', {}, sessionId)
  await send('Network.setCookie', { name: 'laravel_session', value: cookie, domain: '127.0.0.1', path: '/', httpOnly: true }, sessionId)
  await send('Page.navigate', { url: task.url }, sessionId)
  await sleep(2500)
  if (task.clickText) {
    await send('Runtime.evaluate', {
      expression: `(() => { const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === ${JSON.stringify(task.clickText)}); if (el) { (el.closest('button,li,a,div') || el).click(); return 'clicked' } return 'not-found' })()`,
      returnByValue: true,
    }, sessionId)
    await sleep(1500)
  }
  // 等正文里出现期望文本，最多 20 秒
  let seen = ''
  for (let i = 0; i < 40; i++) {
    const res = await send('Runtime.evaluate', { expression: 'document.body ? document.body.innerText : ""', returnByValue: true }, sessionId)
    seen = res.result?.value ?? ''
    if (!task.waitFor || seen.includes(task.waitFor)) break
    await sleep(500)
  }
  if (task.settle) await sleep(task.settle)
  await sleep(800)
  const captured = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  fs.writeFileSync(path.join(OUT, task.name + '.png'), Buffer.from(captured.data, 'base64'))
  const ok = !task.waitFor || seen.includes(task.waitFor)
  console.log((ok ? '  OK   ' : '  没等到内容 ') + task.name + '  ' + Math.round(fs.statSync(path.join(OUT, task.name + '.png')).size / 1024) + 'KB')
}

for (const task of tasks) await shot(task)
ws.close()
edge.kill()
await sleep(1000)
console.log('\n截图目录: ' + OUT)