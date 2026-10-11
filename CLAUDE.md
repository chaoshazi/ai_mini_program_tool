# miniwechat

AI 小程序开发工具：用户在 Web 控制台用自然语言描述需求，工具在隔离工作目录里生成/修改一套
**uni-app（Vue3 + TS）小程序前端 + 自带 Node 后端**的工程，实时展示生成过程与页面预览，并可导出 zip。

闭环：**新建项目 → 对话生成/修改 → 自动构建校验（失败回灌重试）→ 浏览器 H5 预览（前端 + 后端一起跑）→ 导出 zip**。
不依赖任何外部既有 AI 能力层；v1 为本地单用户，无登录与多租户。

## 技术栈（版本只在本文档维护，技能里不重复写）

| 层 | 技术 |
| --- | --- |
| 工具后端 | Node 22（`engines: >=22.5`）+ TypeScript 5.7 + Fastify 5 + SSE + `node:sqlite`（`DatabaseSync`，零原生依赖） |
| 控制台 | Vite 6 + React 18 + TypeScript 5.7 + Tailwind CSS 4 |
| 生成物前端 | uni-app（Vue3 `<script setup>` + TS），浏览器预览运行时装 = Vite 6 + `@vitejs/plugin-vue` 5 + `vue-tsc` |
| 生成物后端 | Node + Express 4 + TS（tsx 运行），内存存储 + 可选 JSON 落盘 |
| 模型 | OpenAI 兼容协议，默认 DeepSeek 官方（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`） |
| 测试 | `node --test` + tsx，无额外测试框架 |

## 端口与目录

| 用途 | 端口/路径 |
| --- | --- |
| 工具后端 API | `9320`（`MW_SERVER_PORT`） |
| 控制台 dev | `5180`（`/api`、`/preview` 代理到 9320） |
| 每项目预览 | client = `9400 + slot*2`，api = `9400 + slot*2 + 1`（`MW_PREVIEW_PORT_BASE`） |

```
server/src/agent      生成链路：提示词、工具集、模型客户端、编排循环、离线脚手架
server/src/templates  工程模板（真实文件，按 {{占位符}} 渲染到 var/workspaces/<id>/）
server/src/runtime    沙箱与运行期：路径守卫、命令白名单、补丁、构建校验、预览编排、zip 导出
server/src/api        路由 + SSE 契约（schemas.ts 是前端类型的唯一来源）+ 预览反向代理
server/src/store      SQLite 迁移与仓储（表：projects / messages / runs / files）
web/src               控制台（React）
var/                  运行期产物（gitignore）：miniwechat.db、workspaces/<id>/、exports/、logs/
```

## 常用命令

```powershell
npm install                  # 根目录安装两个 workspace 的依赖
npm run dev                  # 同时起工具后端(9320) 与控制台(5180)
npm run build                # 构建 server(dist) 与 web(dist)
npm run typecheck            # 两个 workspace 的类型校验
npm run test                 # 后端单测（30 个用例，秒级）
npm run gen:types            # 由 schemas.ts 生成 web/src/api/types.ts
```

后端独有的自检（在 `server/` 下执行，或 `npm run <script> --workspace server`）：

```powershell
npm run smoke:template       # 模板冒烟：渲染示例工程 -> npm install -> typecheck -> H5 构建
npm run check:render         # 渲染校验：SSR 渲染生成工程的首页，断言页面真的渲染出内容
npm run smoke                # 端到端冒烟：新建项目 -> SSE 生成 -> 预览 200 -> 导出 zip -> 回收端口（需先起后端）
npm run gen:types:check      # 只校验 web 类型是否与 schemas.ts 同步
```

## 环境变量

复制 `.env.example` 为 `.env`（已被 gitignore）。**不填 `LLM_API_KEY` 时自动进入离线脚手架模式**：
按模板生成示例工程并照常走构建/预览/导出，全链路仍然可跑通。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | `https://api.deepseek.com/v1` / 空 / `deepseek-chat` | OpenAI 兼容模型接入 |
| `MW_SERVER_PORT` | `9320` | 工具后端端口 |
| `MW_VAR_DIR` | `var` | 运行期目录 |
| `MW_BUILD_RETRIES` | `2` | 构建失败后自动回灌重试次数上限 |
| `MW_COMMAND_TIMEOUT_MS` | `240000` | 生成工程里单条命令超时 |
| `MW_PREVIEW_CONCURRENCY` | `4` | 同时运行的预览数（也是端口槽位上限） |

## 代码约定

- 单引号、2 空格缩进、中文注释、UTF-8 无 BOM、LF 换行。
- 生成代码只能写进 `var/workspaces/<projectId>/`；命令白名单只有 `npm` / `node` / `npx`，参数禁止 shell 元字符。
- 改 `server/src/api/schemas.ts` 的契约后必须跑 `npm run gen:types`（有测试与 `gen:types:check` 兜底）。
- 改工程模板后必须跑 `npm run smoke:template` 与 `npm run check:render`。
- 起后端统一用 `node --disable-warning=ExperimentalWarning --import tsx ...`（见 `server/package.json`）：
  Node 22 的 `node:sqlite` 仍会打印实验特性告警，用该开关静音，而不是全局 `--no-warnings`。

## v1 的边界（有意为之）

- 预览用内置的浏览器运行时装 `client/preview/`（见 preview / templates 技能），**不安装** `@dcloudio/*`；
  生成物仍是标准 uni-app 工程，可用 HBuilderX / uni-app CLI 编译到微信小程序。
- 预览关闭 HMR，代码更新后由工具重启 client 进程刷新；真机 / 微信开发者工具内预览不在 v1 范围。
- 导出为 zip 下载 + README 导入说明，不做一键推 Git。