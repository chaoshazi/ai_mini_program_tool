---
name: api
description: 改 D:\miniwechat 工具自身接口时使用：REST 路由与统一响应体、SSE 事件契约与方法/参数、schemas.ts 与 web 类型同步、预览代理与静态托管。不适用于改生成工程里那套接口（那是模板，看 templates）。
---

# 工具自身接口

## 结构

- `server/src/api/schemas.ts`：**契约唯一来源**——统一响应体 `{ code, message, data }`、错误码、SSE 事件名与各事件体。
  被 `// #region web-types` / `// #endregion web-types` 独占行包围的区段会被 `npm run gen:types` 抽到 `web/src/api/types.ts`。
- `server/src/api/routes.ts`：REST + SSE 路由。
- `server/src/api/proxy.ts`：`/preview/*` 反向代理（HTTP + WS）。
- `server/src/app.ts`：CORS、错误处理器、空 body 的 JSON 解析器、路由注册、`web/dist` 静态托管与 SPA 回退。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | ok / schemaVersion / llm / previews |
| GET POST | `/api/projects` | 列表 / 新建（返回 201） |
| GET PATCH DELETE | `/api/projects/:id` | 详情（含 preview）/ 改名 / 删除（停预览 + 清工作目录） |
| GET | `/api/projects/:id/files` `/files/*path` | 文件列表 / 单文件内容 |
| GET | `/api/projects/:id/messages` `/runs` | 对话与运行记录 |
| POST | `/api/projects/:id/messages` | **SSE**：`plan → tool* → file* → delta* → build → preview → done`，失败以 `error` 收尾 |
| GET POST | `/api/projects/:id/preview` | 查状态 / start（`{action:'stop'}` 或 DELETE 也可停） |
| POST | `/api/projects/:id/export` | 生成 zip，返回 `{filename, url, bytes, entries}` |
| GET | `/api/projects/:id/export.zip?file=` | 二进制下载 |

## 不变量

- 所有 JSON 接口成功时 `code = 0`；错误码集中在 `server/src/util/errors.ts` 的 `ApiCode`，HTTP 状态由 `ApiError` 带出。
  **唯一例外**是 zip 下载（二进制流）与 SSE（`text/event-stream`）。
- SSE 帧格式固定：`event: <type>\n` + `data: <SseEnvelope JSON>\n\n`，`SseEnvelope` 里带 `type/runId/at/data`；
  每 15s 发一次 `: ping` 注释保活；流以 `reply.raw.end()` 结束，**没有**额外的 close 事件。
- 用了 `reply.hijack()` 就必须自己写响应头与结束响应；不要在 hijack 之后再调 `reply.send`。
- 改 `schemas.ts` 后必须跑 `npm run gen:types`；`tests/contract.test.ts` 会断言 `web/src/api/types.ts` 与生成结果一致。
- 空 body + `content-type: application/json` 的请求（如 `POST /export`）靠 `app.ts` 里的自定义 JSON 解析器兜住，
  删了它前端就会踩到 `Body cannot be empty`。
- 声明式规则：新接口一律走 `requireProject()` 校验项目存在，路径里出现不存在资源统一返回 40401。

## 验证

```powershell
npm run typecheck                      # 两个 workspace（web 那侧靠生成好的 types.ts）
npm run test --workspace server        # contract.test.ts：事件名/帧格式/错误码/类型同步
npm run smoke --workspace server       # 真实 HTTP + SSE + 代理 + 导出下载全链路
```