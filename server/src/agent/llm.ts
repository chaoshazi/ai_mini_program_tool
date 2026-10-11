// OpenAI 兼容模型接入（默认 DeepSeek）。用流式拉取，把文本增量实时转发给控制台。
import type { LlmConfig } from '../config.js'
import { ApiError } from '../util/errors.js'
import { Logger } from '../util/logger.js'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
  name?: string
}

export interface ToolSchema {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
}

export interface ChatResult {
  content: string
  toolCalls: ToolCall[]
  finishReason: string
  usage: ChatUsage | null
}

export interface ChatOptions {
  messages: ChatMessage[]
  tools?: ToolSchema[]
  temperature?: number
  maxTokens?: number
  onDelta?: (text: string) => void
  signal?: AbortSignal
}

interface StreamDelta {
  content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

export class LlmClient {
  constructor(
    private readonly config: LlmConfig,
    private readonly logger: Logger,
  ) {}

  get enabled(): boolean {
    return this.config.enabled
  }

  get model(): string {
    return this.config.model
  }

  /** 单次对话补全。返回最终文本与工具调用（增量已累积成完整参数 JSON）。 */
  async chat(options: ChatOptions): Promise<ChatResult> {
    if (!this.config.enabled) throw new ApiError(50002, '未配置 LLM_API_KEY，无法调用模型', 500)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    const onAbort = (): void => controller.abort()
    options.signal?.addEventListener('abort', onAbort)

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: options.messages,
      stream: true,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? this.config.maxTokens,
      stream_options: { include_usage: true },
    }
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = 'auto'
    }

    let response: Response
    try {
      response = await fetch(this.config.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + this.config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timer)
      const message = error instanceof Error ? error.message : String(error)
      throw new ApiError(50002, '调用模型失败（' + this.config.baseUrl + '）：' + message, 502)
    }

    try {
      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '')
        throw new ApiError(50002, '模型返回 HTTP ' + response.status + '：' + text.slice(0, 400), 502)
      }
      return await this.consumeStream(response.body, options)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  private async consumeStream(stream: ReadableStream<Uint8Array>, options: ChatOptions): Promise<ChatResult> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    const calls = new Map<number, ToolCall>()
    let buffer = ''
    let content = ''
    let finishReason = ''
    let usage: ChatUsage | null = null

    const handleChunk = (payload: string): void => {
      if (!payload || payload === '[DONE]') return
      let parsed: { choices?: Array<{ delta?: StreamDelta; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      try {
        parsed = JSON.parse(payload)
      } catch {
        this.logger.warn('模型返回了非 JSON 分片，已跳过：' + payload.slice(0, 120))
        return
      }
      if (parsed.usage) {
        usage = { promptTokens: parsed.usage.prompt_tokens ?? 0, completionTokens: parsed.usage.completion_tokens ?? 0 }
      }
      const choice = parsed.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (!delta) return
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content
        options.onDelta?.(delta.content)
      }
      for (const partial of delta.tool_calls ?? []) {
        const index = partial.index ?? 0
        const current = calls.get(index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } }
        if (partial.id) current.id = partial.id
        if (partial.function?.name) current.function.name = partial.function.name
        if (partial.function?.arguments) current.function.arguments += partial.function.arguments
        calls.set(index, current)
      }
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.startsWith('data:')) handleChunk(line.slice(5).trim())
        newline = buffer.indexOf('\n')
      }
    }
    if (buffer.trim().startsWith('data:')) handleChunk(buffer.trim().slice(5).trim())

    const toolCalls = Array.from(calls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, call]) => call)
      .filter((call) => call.function.name.length > 0)

    return { content, toolCalls, finishReason, usage }
  }
}

/** 工具参数是模型生成的 JSON 字符串，解析失败要给出可读错误以便回灌。 */
export function parseToolArguments(raw: string, toolName: string): Record<string, unknown> {
  const text = (raw ?? '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    throw new Error('参数必须是 JSON 对象')
  } catch (error) {
    throw ApiError.badRequest(
      '工具 ' + toolName + ' 的参数不是合法 JSON：' + (error as Error).message + '，原始内容：' + text.slice(0, 300),
    )
  }
}