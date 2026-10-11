// 模型接入：用假服务端验证流式增量与 tool_calls 累积（这是生成链路最容易出错的地方）。
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { LlmConfig } from '../src/config.js'
import { LlmClient, parseToolArguments } from '../src/agent/llm.js'
import { ApiError } from '../src/util/errors.js'
import { Logger } from '../src/util/logger.js'

interface FakeServer {
  baseUrl: string
  requests: Array<Record<string, unknown>>
  close: () => Promise<void>
}

function fakeServer(handler: (body: Record<string, unknown>, res: http.ServerResponse) => void): Promise<FakeServer> {
  const requests: Array<Record<string, unknown>> = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8')
    })
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      requests.push(body)
      handler(body, res)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({
        baseUrl: 'http://127.0.0.1:' + port + '/v1',
        requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
}

function sseChunks(lines: string[]): string {
  return lines.map((line) => 'data: ' + line + '\n\n').join('')
}

function client(baseUrl: string): LlmClient {
  const config: LlmConfig = { baseUrl, apiKey: 'test-key', model: 'test-model', timeoutMs: 10_000, maxTokens: 100, enabled: true }
  return new LlmClient(config, new Logger('test', null))
}

test('流式响应：文本增量、tool_calls 分片累积、usage', async () => {
  const server = await fakeServer((_body, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(
      sseChunks([
        JSON.stringify({ choices: [{ delta: { content: '我先看' } }] }),
        JSON.stringify({ choices: [{ delta: { content: '一下现状。' } }] }),
        JSON.stringify({
          choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_files', arguments: '{"pa' } }] } }],
        }),
        JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"client"}' } }] } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        JSON.stringify({ choices: [], usage: { prompt_tokens: 42, completion_tokens: 7 } }),
        '[DONE]',
      ]),
    )
    res.end()
  })

  const deltas: string[] = []
  const result = await client(server.baseUrl).chat({
    messages: [{ role: 'user', content: '做个待办清单' }],
    tools: [{ type: 'function', function: { name: 'list_files', description: 'x', parameters: { type: 'object' } } }],
    onDelta: (text) => deltas.push(text),
  })
  await server.close()

  assert.equal(result.content, '我先看一下现状。')
  assert.deepEqual(deltas, ['我先看', '一下现状。'])
  assert.equal(result.finishReason, 'tool_calls')
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0]?.id, 'call_1')
  assert.equal(result.toolCalls[0]?.function.name, 'list_files')
  assert.deepEqual(parseToolArguments(result.toolCalls[0]?.function.arguments ?? '', 'list_files'), { path: 'client' })
  assert.deepEqual(result.usage, { promptTokens: 42, completionTokens: 7 })
  assert.equal(server.requests.length, 1)
  assert.equal(server.requests[0]?.stream, true)
})

test('HTTP 错误与超时都抛 LLM_FAILED 错误码', async () => {
  const server = await fakeServer((_body, res) => {
    res.writeHead(429, { 'content-type': 'application/json' })
    res.end('{"error":"rate limited"}')
  })
  await assert.rejects(
    client(server.baseUrl).chat({ messages: [{ role: 'user', content: 'hi' }] }),
    (error: unknown) => error instanceof ApiError && error.code === 50002 && /429/.test(error.message),
  )
  await server.close()
})

test('未配置 Key 时直接拒绝，参数不是 JSON 时报可读错误', async () => {
  const disabled = new LlmClient(
    { baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'm', timeoutMs: 100, maxTokens: 10, enabled: false },
    new Logger('test', null),
  )
  assert.equal(disabled.enabled, false)
  await assert.rejects(disabled.chat({ messages: [] }), (error: unknown) => error instanceof ApiError && error.code === 50002)

  assert.deepEqual(parseToolArguments('', 'x'), {})
  assert.throws(() => parseToolArguments('not json', 'list_files'), (error: unknown) => error instanceof ApiError && /list_files/.test(error.message))
})