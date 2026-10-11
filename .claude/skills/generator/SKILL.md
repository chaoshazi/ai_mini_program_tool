---
name: generator
description: 改 D:\miniwechat 的 AI 生成链路（Agent 循环、系统提示词、工具集、构建失败回灌重试、离线脚手架）时使用。不适用于只改控制台 UI、只改工程模板内容（看 templates）、或只改模型接入参数（看 llm）。
---

# 生成链路

## 结构

一轮生成 = `plan → 工具调用/文件落盘 → 本工程内自检 → 构建校验（失败回灌，最多 MW_BUILD_RETRIES 次）→ 预览就绪 → done`。

| 文件 | 职责 |
| --- | --- |
| `server/src/agent/loop.ts` | 编排：建 run 记录、前置快照、agent 循环、构建重试、预览刷新、diff 出变更清单、发 done/error |
| `server/src/agent/tools.ts` | 工具集定义与执行：`list_files` / `read_file` / `write_file` / `apply_patch` / `run_command` / `finish` |
| `server/src/agent/prompts.ts` | 系统提示词与需求/修复提示词 |
| `server/src/agent/llm.ts` | OpenAI 兼容流式客户端（累积 content 与 tool_calls） |
| `server/src/agent/scaffold.ts` | 无 Key 时的离线脚手架（渲染模板）与 `toAppName` |
| `server/src/agent/events.ts` | 事件发送器（补 runId/时间戳，记录 sent 顺序供测试断言） |
| `server/src/agent/diff.ts` | 两轮文件索引对比得到 create/update/delete |

新模式的关键点：**新项目先渲染模板骨架再让模型在其上改**（`seedTemplateIfEmpty`），保证任何模型输出都有一个能跑通的基线。

## 不变量

- 工具执行出错不要直接中断整轮：把错误文本回灌给模型（`agentLoop` 里 try/catch → `role: 'tool'` 消息），
  只有构建重试次数用尽才以 `error` 事件结束并保留产物。
- 一轮里文件的真实变更以「工具写入记录」为准，`diffIndex` 只作为兜底；两者都要进 `done.files`。
- 修改文件前必须让模型先 `read_file`（提示词里写死了这条）；`apply_patch` 的 SEARCH 必须唯一匹配，否则报错回灌。
- 事件顺序契约（`done` 结尾、失败以 `error` 结尾）由 `server/scripts/smoke.ts` 断言，改链路后必须重跑。
- 无 Key 时**不允许**尝试调用模型：`config.llm.enabled` 为 false 就直接走离线分支。

## 验证

```powershell
npm run test --workspace server          # 含 diff / llm 流式累积 的单测
npm run smoke --workspace server         # 端到端：事件序列 plan → … → build → preview → done
```

手工核对：改完提示词后，在控制台发一条需求，看事件时间线里是否出现 `tool`（模型模式）与 `build`（含每项检查耗时），
以及 `var/workspaces/<id>/` 里的文件是否符合预期。