---
name: llm
description: 改 D:\miniwechat 的模型接入与提示词时使用：环境变量、OpenAI 兼容流式解析、超时与 token 上限、tool_calls 累积、无 Key 时的降级策略。不适用于改工具集本身的语义（看 generator）或改执行边界（看 sandbox）。
---

# 模型接入与提示词

## 结构

- `server/src/agent/llm.ts`：`LlmClient.chat()` —— `POST {baseUrl}/chat/completions`，`stream: true`，
  以增量方式累积 `delta.content` 与按 `index` 分片的 `delta.tool_calls`，返回 `{content, toolCalls, finishReason, usage}`；
  `parseToolArguments` 把参数 JSON 字符串解析成对象（失败给可读错误，供回灌）。
- `server/src/agent/prompts.ts`：`buildSystemPrompt`（角色 + 工程结构与硬约定 + 工作方式）、`buildUserPrompt`（含最近几轮对话）、
  `buildFixPrompt`（把构建错误摘要塞回对话）。
- 配置在 `server/src/config.ts`：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_TIMEOUT_MS` / `LLM_MAX_TOKENS`。

## 不变量

- `config.llm.enabled` 只看 `LLM_API_KEY` 是否非空：无 Key 时**不发起任何网络请求**，直接走离线脚手架（`agent/scaffold.ts`）。
- 超时用 `AbortController` 统一实现，并把外部 `signal`（SSE 客户端断开）接进来：客户端断开要立刻取消模型请求。
- 流解析必须容忍脏数据：非 JSON 分片只记 warn 跳过；`[DONE]` 忽略；`usage` 可能出现在最后一个 chunk（`stream_options.include_usage`）。
- 工具参数 JSON 不完整/非法不能崩链路：`parseToolArguments` 抛 `ApiError.badRequest`，由 `agentLoop` 回灌给模型自我纠正。
- 提示词里写死的工程约定必须与模板一致（request.ts 是唯一请求入口、页面登记在 pages.json、统一响应体 `{code,message,data}`、
  不与 HTML/SVG 同名的标签用 class 而不是 uni 专属属性）。改模板时要同步改提示词。
- 错误一律用 `ApiError(50002)`，不要直接抛 fetch 的原始错误（前端要靠 code 给提示）。

## 验证

```powershell
npm run test --workspace server     # llm.test.ts：假服务端验证增量、tool_calls 分片累积、usage、HTTP 错误、无 Key 拒绝
```

联调真实模型：在 `.env` 填 `LLM_API_KEY`，重启后端，发一条需求，用 `MW_LOG_LEVEL=debug` 看 `delta` 事件是否连续。
提示词改动后必须重跑 `npm run smoke --workspace server`（该场景无 Key 也能跑，只验证降级链路）。