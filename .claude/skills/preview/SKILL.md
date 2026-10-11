---
name: preview
description: 改 D:\miniwechat 的预览与联调链路（client/server 双进程编排、/preview 路径前缀反代、VITE_API_BASE 注入、端口与进程回收）时使用。不适用于改生成工程里的页面代码（看 templates）或生成编排（看 generator）。
---

# 预览与联调

## 结构

`server/src/runtime/preview.ts` 管两个子进程与端口槽位，`server/src/api/proxy.ts` 做路径前缀反向代理：

| 请求 | 上游 |
| --- | --- |
| `/preview/<projectId>/…` | 该项目的 client（Vite H5 dev server），路径**原样透传**（Vite 的 `base` 就是 `/preview/<id>/`） |
| `/preview/<projectId>/api/…` | 该项目的 Node 后端（剥掉 `/preview/<id>` 前缀，`/api` 之后原样） |
| WebSocket upgrade | 同规则转发（预留 HMR 用，当前预览关了 HMR） |

启动流程：分配槽位 → `Builder.ensureDeps()` → 写 `client/.env.local`（`VITE_API_BASE=/preview/<id>`）→ 起
`npm run dev:h5`（注入 `MW_CLIENT_PORT`/`MW_PREVIEW_BASE`）与 `npm run dev`（注入 `MW_API_PORT`）→ 轮询
`/api/health` 与页面 URL 直到 200 → 记 `running`。停止时 `killTree` 回收进程树、释放槽位、删 `.env.local`。

## 不变量

- 端口成对分配且严格互斥：`client = 9400 + slot*2`、`api = 9400 + slot*2 + 1`（见 `runtime/ports.ts`）；
  停止预览必须同时释放槽位，否则并发上限会被慢慢吃满。
- 子进程必须用进程树结束（Windows `taskkill /T /F`，POSIX 进程组），否则 `npm run dev` 的子进程会残留占住端口。
- 代理路由写在**独立封装**的插件作用域里，用 `onRequest` + `reply.hijack()` 交回 Node 原生流：
  Fastify 不会解析 body、也不会插手响应（POST 的 body 要原样透传给上游）。
- 预览关闭 HMR（`client/preview/vite.config.ts` 里 `hmr: false`）：路径前缀代理 + WebSocket 叠加不稳定，
  代码更新后由 `PreviewManager.refresh()` 重启 client 进程来刷新页面。
- 预览失败不算本轮生成失败：`preview` 事件报 error，仍然发 `done`（构建通过就是通过）。
- 同一个项目只允许一个预览实例；`GET /api/projects/:id/preview` 返回当前真实状态供控制台同步。

- 注入的前缀 `VITE_API_BASE=/preview/<id>` **不含 `/api`**（页面里的调用统一写 `/api/xxx`）：两边都带会拼成
  `/api/api/xxx`，落到底层后端就是一个 `接口不存在` 的 404。注入内容由 `previewEnv()` 统一生成。
- 预览端口区间（`base + slot*2` 与 `+1`）里的 **node/npm 监听者会被回收**（`runtime/reclaim.ts`）：
  `tsx watch` 重启不会带走上一轮的子进程，孤儿会一直占着 9400+，让下一次 `strictPort` 启动失败；
  非 node 进程一律不杀，只报 409。
- 每个项目可以挂自己的后端：`projects.api_origin`（接口 `PATCH /api/projects/:id {"apiOrigin":"http://127.0.0.1:8081"}`，
  空串或 null 表示用生成工程自带的 Node 后端）。设了外部后端就**不起** `server/` 那份 Node 服务，
  `/preview/<id>/api/...` 直接反代过去（同源，页面代码不用改），守卫也放宽为只要求 `client/package.json` .
- 工具启动时会清两轮残留进程（`runtime/reclaim.ts`）：先按端口扫预览区间，再按命令行扫工作区里的 node/cmd；
  `tsx watch` 重启不会带走上一轮预览的子进程，不清就会一直占着 9400+ 并让下一次 `strictPort` 启动失败。
  只回收 node/npm/cmd，别的进程一律不动（端口被非 node 进程占用时返回 409 并写清是谁）.
## 验证

```powershell
npm run smoke --workspace server    # 断言：预览 URL 200、代理下 /api/health 可用、DELETE 后不再 200
Invoke-RestMethod http://127.0.0.1:9320/api/projects/<id>/preview
```

手工排查：`netstat -ano | findstr 9400`（残留进程）→ 直接访问 `http://127.0.0.1:9320/preview/<id>/`（不带代理的原始上游）
→ 进 `var/workspaces/<id>/client` 手跑 `npm run dev:h5` 看 Vite 报错。