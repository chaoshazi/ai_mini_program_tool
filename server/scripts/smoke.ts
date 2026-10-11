// 端到端冒烟：新建项目 -> 发一条需求（SSE）-> 校验事件契约 -> 预览可访问 -> 导出 zip。
// 前置：先在另一个终端跑 `npm run dev:server`（或 npm run start）。
// 用法：npm run smoke -- [需求文本]   环境变量 MW_SERVER_ORIGIN 可覆盖后端地址。
const origin = process.env.MW_SERVER_ORIGIN ?? 'http://127.0.0.1:' + (process.env.MW_SERVER_PORT ?? '9320')
const requirement = process.argv.slice(2).filter((arg) => !arg.startsWith('--')).join(' ') || '做一个待办清单小程序'

interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(origin + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await response.json()) as ApiEnvelope<T>
  if (body.code !== 0) throw new Error('接口 ' + path + ' 返回 code=' + body.code + ' ' + body.message)
  return body.data
}

function fail(message: string): never {
  console.error('✗ ' + message)
  process.exit(1)
}

const health = await api<{ ok: boolean; llm: { enabled: boolean; model: string } }>('/api/health')
console.log('后端健康检查 OK，模型：' + (health.llm.enabled ? health.llm.model : '未配置（离线脚手架模式）'))

const project = await api<{ id: string; name: string; mode: string }>('/api/projects', {
  method: 'POST',
  body: JSON.stringify({ name: '冒烟-' + Date.now(), description: 'miniwechat 端到端冒烟' }),
})
console.log('已新建项目 ' + project.id + '（' + project.name + '）')

// --- 发需求，消费 SSE ---
const events: Array<{ type: string; data: Record<string, unknown> }> = []
const response = await fetch(origin + '/api/projects/' + project.id + '/messages', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ content: requirement }),
})
if (!response.ok || !response.body) fail('SSE 接口返回 HTTP ' + response.status)

const reader = response.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let done: Record<string, unknown> | null = null
let errorEvent: Record<string, unknown> | null = null

while (true) {
  const { done: finished, value } = await reader.read()
  if (finished) break
  buffer += decoder.decode(value, { stream: true })
  let index = buffer.indexOf('\n\n')
  while (index >= 0) {
    const frame = buffer.slice(0, index)
    buffer = buffer.slice(index + 2)
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
    if (dataLine) {
      try {
        const envelope = JSON.parse(dataLine.slice(6)) as { type?: string; data: Record<string, unknown> }
        if (envelope.type) {
          events.push({ type: envelope.type, data: envelope.data })
          if (envelope.type === 'done') done = envelope.data
          if (envelope.type === 'error') errorEvent = envelope.data
        }
      } catch {
        // 忽略非 JSON 帧
      }
    }
    index = buffer.indexOf('\n\n')
  }
}

const sequence = events.map((event) => event.type)
console.log('事件序列（' + sequence.length + ' 条）：' + sequence.join(' → '))

const first = sequence[0]
if (first !== 'plan') fail('第一个事件应为 plan，实际是 ' + first)
if (errorEvent) fail('出现 error 事件：' + JSON.stringify(errorEvent))
if (!done) fail('没有收到 done 事件')
if (sequence[sequence.length - 1] !== 'done') fail('最后一个事件应为 done，实际是 ' + sequence[sequence.length - 1])
// 离线脚手架模式不会调用工具，所以 tool 只在模型模式下必须出现。
const doneData = done as {
  files: unknown[]
  summary: string
  previewUrl: string | null
  build: { ok: boolean } | null
  mode: string
}
const required = doneData.mode === 'llm' ? ['tool', 'file', 'build', 'preview', 'done'] : ['file', 'build', 'preview', 'done']
for (const name of required) {
  if (!sequence.includes(name)) fail('事件序列缺少 ' + name)
}
console.log('本轮改动 ' + doneData.files.length + ' 个文件；summary=' + doneData.summary)
if (!doneData.build?.ok) fail('done 里构建结果不是成功')

// --- 预览 ---
if (!doneData.previewUrl) fail('done 里没有预览地址')
const previewUrl = origin + doneData.previewUrl
const page = await fetch(previewUrl)
if (page.status !== 200) fail('预览地址返回 HTTP ' + page.status)
const html = await page.text()
if (!html.includes('<div id="app">')) fail('预览页面内容不像预览入口 HTML')
console.log('预览可访问：' + previewUrl + '（' + html.length + ' 字节）')

const apiThroughProxy = await fetch(previewUrl + 'api/health')
const apiBody = (await apiThroughProxy.json()) as ApiEnvelope<{ ok: boolean }>
if (apiThroughProxy.status !== 200 || apiBody.code !== 0) fail('预览代理下的后端接口不可用')
console.log('预览代理下的后端接口可用：' + previewUrl + 'api/health')

// --- 导出 ---
const exported = await api<{ filename: string; url: string; bytes: number; entries: number }>(
  '/api/projects/' + project.id + '/export',
  { method: 'POST', body: '{}' },
)
if (exported.entries < 20) fail('导出文件数量异常：' + exported.entries)
const zip = await fetch(origin + exported.url)
if (zip.status !== 200) fail('下载导出包失败：HTTP ' + zip.status)
const zipBytes = Buffer.from(await zip.arrayBuffer())
if (zipBytes.byteLength !== exported.bytes) fail('导出包大小与返回的 bytes 不一致')
if (zipBytes.subarray(0, 2).toString('binary') !== 'PK') fail('导出文件不是 zip')
console.log('导出 OK：' + exported.filename + '（' + exported.entries + ' 个文件，' + exportLabel(exported.bytes) + '）')

// --- 停止预览，确认端口回收 ---
await api('/api/projects/' + project.id + '/preview', { method: 'DELETE' })
await new Promise((resolve) => setTimeout(resolve, 800))
const afterStop = await fetch(previewUrl).catch(() => null)
if (afterStop && afterStop.status === 200) fail('停止预览后代理仍然返回 200')
console.log('预览已停止，代理不再返回 200')

await api('/api/projects/' + project.id, { method: 'DELETE' })
console.log('✓ 端到端冒烟通过')

function exportLabel(bytes: number): string {
  return (bytes / 1024).toFixed(1) + 'KB'
}

export {}
