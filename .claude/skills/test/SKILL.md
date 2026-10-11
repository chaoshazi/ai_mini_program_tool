---
name: test
description: 在 D:\miniwechat 里写或改测试时使用：后端单测、SSE 契约测试、模板冒烟与渲染校验、假模型服务端夹具的写法。不适用于只改业务代码（先看对应链路技能），也不适用于把测试换成其它框架。
---

# 测试

## 结构

后端单测放 `server/tests/*.test.ts`，用 Node 内置 runner（无 vitest/jest）：

```powershell
npm run test --workspace server        # = node --disable-warning=ExperimentalWarning --import tsx --test tests/*.test.ts
```

| 文件 | 覆盖 |
| --- | --- |
| `paths.test.ts` | 路径越界（`..` / 绝对 / 盘符 / NUL / 符号链接逃逸）与忽略目录 |
| `command.test.ts` | 分词、白名单、shell 元字符拒绝、真实执行 `node --version` |
| `patch.test.ts` | Update/Add/Delete 解析、多块顺序应用、找不到/多处命中的可读报错 |
| `llm.test.ts` | **假模型服务端**（本地 `http.createServer` 播 SSE 分片）验证增量与 tool_calls 累积 |
| `store.test.ts` | 迁移可重开、项目/消息/运行 CRUD、级联删除 |
| `zip.test.ts` | 自写 zip 的结构可被解析回原内容、可复现 |
| `export.test.ts` | 导出排除 node_modules/dist、必须有 README、文件名防穿越 |
| `templates.test.ts` | 占位符清单一致、整目录渲染后不残留占位符、页面文件都存在 |
| `contract.test.ts` | SSE 事件名与事件体一一对应、帧格式、错误码文案、web 类型同步 |
| `diff.test.ts` | 两轮文件索引的 create/update/delete |

端到端与跨进程的场景不写单测，写成脚本：`scripts/smoke.ts`（真实 HTTP + SSE 事件序列 + 预览 200 + 导出下载 + 端口回收）、
`scripts/smoke-template.ts`（渲染 + npm install + typecheck + H5 构建）、`scripts/render-check.ts`（SSR 渲染首页断言真实内容）。

## 不变量

- 用 `node:test` 的 `test()` + `node:assert/strict`；不引入新依赖。
- 断言失败信息要带上下文（例如「应该拒绝：<原始输入>」），因为这些测试是排查越界/命令注入的第一入口。
- 需要临时目录就用 `fs.mkdtempSync(path.join(os.tmpdir(), 'mw-xxx-'))`，不要往 `var/workspaces/` 里写测试数据。
- 单测必须秒级、离线、可重复：不依赖真实模型 Key，不依赖 9320 端口（需要 HTTP 就自己起临时服务端，端口用 0 让系统分配）。
- 改了契约/模板/生成链路后，`tests/contract.test.ts` 与两个冒烟脚本是必跑项（见 qa-workflow 技能）。
- 事件序列断言只在模型模式要求出现 `tool`：离线脚手架不调用工具（`smoke.ts` 里按 `done.mode` 分支）。

- 改了页面/请求/预览注入以后，光跑 SSR 与接口探活不够——**再跑一次真浏览器检查**：
  `npm run check:browser -- prj_xxx "共 8 个科室" "内科学系"`（无头 Edge/Chrome 渲染后断言 DOM 里有期望内容）.
  它专门覆盖"页面能打开但里面没数据/渲染出几百个空行"这类只有真浏览器才看得见的问题.
## 验证

```powershell
npm run test --workspace server        # 全绿
npm run smoke:template --workspace server
npm run check:render --workspace server
```

新增边界/契约时同时补用例：新的错误码、新事件类型、新工具、新占位符都必须有对应断言，否则视为没做完。