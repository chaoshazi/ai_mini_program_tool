# {{appTitle}}

{{description}}

由 miniwechat（AI 小程序开发工具）生成：**uni-app（Vue3 + TS）小程序前端 + 自带 Node 后端**，一个仓库里前后端一起开发。

## 目录结构

```
{{appName}}/
├─ client/                 uni-app（Vue3 + TS）前端
│  ├─ src/pages.json       页面注册与 tabBar
│  ├─ src/manifest.json    小程序 appid / 平台配置
│  ├─ src/pages/           页面（首页 + 关于页）
│  ├─ src/api/request.ts   统一请求封装（baseURL 读 VITE_API_BASE）
│  └─ preview/             浏览器预览运行时装（见下文）
├─ server/                 自带 Node 后端（Express + TS）
│  ├─ src/index.ts         启动入口（端口 MW_API_PORT，默认 9401）
│  ├─ src/routes.ts        REST 接口，统一返回 { code, message, data }
│  └─ src/store.ts         内存存储 + 可选 JSON 落盘
└─ scripts/dev.mjs         一条命令同时起前后端（零依赖）
```

## 快速开始

```bash
npm install          # 装 client 与 server 的依赖（workspaces）
npm run dev          # 同时起前端预览（9400）与后端（9401）
```

浏览器打开 `http://127.0.0.1:9400` 就能看到页面；后端健康检查 `http://127.0.0.1:9401/api/health`。

常用命令：

| 命令 | 作用 |
| --- | --- |
| `npm run typecheck` | 前后端类型校验（vue-tsc + tsc） |
| `npm run build` | 构建 H5 静态产物（client/dist-h5）+ 编译后端（server/dist） |
| `npm run dev` | 本地开发：H5 预览 + 接口服务 |

## 在微信开发者工具 / HBuilderX 里运行

`client/` 是标准 uni-app 工程（`pages.json` + `manifest.json` + `pages/`）：

1. 用 **HBuilderX** 打开 `client/` 目录，或用 uni-app CLI（`@dcloudio/*`）。
2. 在 `client/src/manifest.json` 里填上你的 `mp-weixin.appid`。
3. HBuilderX → 运行 → 运行到小程序模拟器 → 微信开发者工具。
4. 真机/生产环境记得把 `VITE_API_BASE` 改成你的后端地址（见下），并用 HTTPS 域名。

> 本工程 v1 没有内置 `@dcloudio/*` 依赖：`client/src/uni-app.d.ts` 与 `src/types/*.d.ts` 只是为了让 `vue-tsc` 能校验，
> 安装官方依赖后可以删掉它们，避免类型冲突。

## 浏览器预览运行时装（client/preview/）

`client/preview/` 是一个轻量运行时装，让标准 uni-app 源码能直接在浏览器里跑（工具控制台里的「预览」用的就是它）：

- `index.html` + `main.ts`：预览入口，挂载 `src/App.vue` 与当前页；
- `uni-shim.ts`：`uni.request / showToast / navigateTo / setStorageSync` 等常用 API 的浏览器实现；
- `uni-components.ts`：`view / text / button / input / scroll-view` 等内置组件；
- `app-shell.ts`：按 `pages.json` 渲染页面、生成 tabBar；
- `uni-app-lifecycle.ts`：通过 Vite alias 顶替 `@dcloudio/uni-app`，实现 `onLoad / onShow` 等生命周期。

限制：只实现了用到的 API 子集；不模拟下拉刷新、触底事件、原生导航栏与真机差异。真机行为请以微信开发者工具为准。

## 接口约定

所有接口返回 `{ code, message, data }`，`code === 0` 表示成功：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查：uptime、条目数、版本 |
| GET | `/api/todos` | 列表（按创建时间倒序） |
| POST | `/api/todos` | 新建，body `{ title }` |
| PATCH | `/api/todos/:id` | 更新，body `{ title?, done? }` |
| DELETE | `/api/todos/:id` | 删除 |

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE` | 空（同源） | 后端地址前缀，**不含 /api**（调用方统一写 `/api/xxx`）；预览时工具写进 `client/.env.local` |
| `MW_API_PORT` | `9401` | 后端端口 |
| `MW_CLIENT_PORT` | `9400` | H5 预览端口 |
| `MW_DATA_FILE` | `data/todos.json` | 数据落盘路径，设成 `memory` 则纯内存 |

## 下一步改哪里

- 加页面：新建 `client/src/pages/<名字>/<名字>.vue`，并在 `client/src/pages.json` 的 `pages` 里注册（要放进 tabBar 就同时加到 `tabBar.list`）。
- 加接口：在 `server/src/routes.ts` 里加路由，存储逻辑写进 `server/src/store.ts`。
- 改字段：`client/src/api/types.ts` 与 `server/src/store.ts` 里的类型要一起改。

生成时间：{{createdAt}}