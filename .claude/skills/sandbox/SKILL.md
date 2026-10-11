---
name: sandbox
description: 改 D:\miniwechat 里「生成代码能碰什么」的边界时使用：工作目录与路径穿越校验、命令白名单与超时、输出截断、进程树回收、失败清理。不适用于改模型提示词（看 llm）或改模板内容（看 templates）。
---

# 执行边界

## 结构

| 文件 | 职责 |
| --- | --- |
| `server/src/runtime/paths.ts` | `resolveInside(root, rel)`：归一化、拒绝绝对/盘符/`..`/NUL，并逐级用 realpath 挡符号链接逃逸；`IGNORED_DIRS` |
| `server/src/runtime/workspace.ts` | `Workspace`：唯一读写入口（read/write/delete/listFiles/snapshotIndex/wipe），根目录 `var/workspaces/<projectId>/` |
| `server/src/runtime/command.ts` | `tokenize` / `assertAllowed` / `runCommand` / `spawnTokens` / `killTree` |
| `server/src/runtime/patch.ts` | search/replace 补丁解析与应用（找不到或多处命中都报可读错误） |
| `server/src/agent/tools.ts` | 工具执行层：把越界/被拒错误转成回灌给模型的文本 |

## 不变量

- 任何出自模型或 HTTP 的路径都必须过 `Workspace.resolve`；禁止自己拼 `path.join(root, userInput)`。
- 命令白名单只有 `npm` / `node` / `npx`，且**命令名不能带路径**；参数里出现 `& | ; < > ^ \` $ ! % ( ) { } [ ] * ? " ' \` 等
  shell 元字符直接拒绝（Windows 下必须 `shell: true` 才能跑 `.cmd`，所以靠参数校验兜住注入）。
- 每次执行都带超时（`MW_COMMAND_TIMEOUT_MS`）与输出截断（保留头尾、中间标注截断量）；超时与失败都要结束整棵进程树。
- 内部可信流程（构建、预览、渲染校验）走 `spawnTokens` 绕过白名单检查，但 cwd 仍必须在工作目录内。
- 工具报错不要抛出到编排层：`executeTool` 的异常由 `agentLoop` 捕获并作为 tool 消息回灌，只有构建重试耗尽才终止。
- 失败的生成也必须留下可诊断痕迹：`error` 事件带上 `detail`（构建错误摘要），run 记录写 `error` 字段并保留产物。

## 验证

```powershell
npm run test --workspace server    # paths / command / patch 三个用例文件覆盖越界、白名单、符号链接、补丁歧义
```

新增边界时要同时加测试：越界路径（含 `..`、绝对路径、盘符、软链）、白名单外命令、元字符参数、超时与截断。