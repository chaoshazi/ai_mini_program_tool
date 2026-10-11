---
name: dev
description: 在 D:\miniwechat 这个 AI 小程序开发工具仓库里起本地全栈、重启某个进程、或排查「打不开 / 连不上 / 端口占用 / 生成卡住」时使用。含端口分配、npm 脚本、var/ 目录含义与排查顺序。不适用于改生成链路（看 generator）、改模板（看 templates）或改控制台界面（看 api 的前端部分）。
---

# 本地全栈与排障

## 结构

| 进程 | 端口 | 启动 | 说明 |
| --- | --- | --- | --- |
| 工具后端 | 9320 | `npm run dev:server` | Fastify + SSE + SQLite + 预览反向代理；同时托管 `web/dist`（若已构建） |
| 控制台 | 5180 | `npm run dev:web` | Vite dev，`/api` 与 `/preview` 代理到 9320（含 WebSocket） |
| 项目预览 | 9400+ | 控制台里点「启动预览」 | 每个项目占两个连续端口：client = base+slot*2，api = base+slot*2+1 |

一条命令起两个：`npm run dev`（根目录，concurrently）。运行期产物都在 `var/`：
`miniwechat.db`（SQLite）、`workspaces/<projectId>/`（生成工程，唯一产物目录）、`exports/*.zip`、`logs/server-<日期>.log`。
清空：`npm run clean`（只删 var/ 与 dist/，不动源码）。

## 不变量

- 后端启动脚本必须是 `node --disable-warning=ExperimentalWarning --import tsx ...`：内置 `node:sqlite`
  仍会打印实验特性告警，`process.emitWarning` 拦不住（内部走的是内部引用），只能靠这个开关静音。
- 配置只在启动时读一次：改 `.env` 后必须**重启后端**。真实 Key 只写 `.env`；`.env.example` 是模板，写进去不生效。
- 没有 `LLM_API_KEY` 时后端会打 WARN 并走离线脚手架模式，这不是故障。
- 预览子进程的端口由 `MW_PREVIEW_CONCURRENCY` 决定槽位数量；残留进程会占住端口，导致「启动预览」报 5 秒超时类错误。
- 控制台 dev 固定监听 127.0.0.1：只绑 `localhost` 时 IPv6 会解析成 `::1`，`127.0.0.1:5180` 连不上。

## 验证

```powershell
Invoke-RestMethod http://127.0.0.1:9320/api/health          # code=0、llm.enabled、schemaVersion
node -e "fetch('http://127.0.0.1:5180/src/main.tsx').then(r=>console.log(r.status))"
Get-NetTCPConnection -State Listen -LocalPort 9320,5180,9400,9401 -ErrorAction SilentlyContinue
```

排查顺序：① `var/logs/` 里最近的 server 日志 → ② `/api/health` → ③ 端口占用（`taskkill /PID <pid> /T /F` 清残留进程树）
→ ④ `var/workspaces/<id>/node_modules` 是否存在（预览前必须先 install）→ ⑤ 预览项目里单独跑 `npm run dev:h5` 看前端报错。