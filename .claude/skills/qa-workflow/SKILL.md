---
name: qa-workflow
description: 在 D:\miniwechat 提交改动前使用：按固定顺序跑类型检查、单测、技能校验、模板冒烟、端到端冒烟，任一失败即停并先修。不适用于只读排查（那时看 dev 技能），也不适用于改其它仓库。
---

# 提交前检查

## 结构

按顺序跑，**任一失败就停下来修，不要继续往下跑**（越靠前的越快、越容易定位）：

```powershell
npm run typecheck                    # 1. 两个 workspace 类型校验（web 依赖生成好的 types.ts）
npm run gen:types:check              # 2. 契约类型是否与 schemas.ts 同步
npm run test                         # 3. 30 个后端单测（秒级）
node scripts/check-skills.mjs        # 4. .claude/skills 的 frontmatter/三节/行数校验
```

涉及生成物（模板、生成链路、预览）时再往下跑：

```powershell
npm run smoke:template --workspace server    # 5. 渲染模板 + install + typecheck + H5 构建
npm run check:render --workspace server      # 6. 断言首页在预览运行时装下真的渲染出内容
npm run dev                                   # 7. 另开终端起后端，再跑端到端
npm run smoke --workspace server              # 8. 事件序列 / 预览 200 / 导出 zip / 端口回收
```

## 不变量

- 顺序不能颠倒：类型都不通过就别跑冒烟，冒烟脚本跑一次要几十秒到几分钟。
- 步骤 5/6 只在**改动触及生成物**时必跑（`server/src/templates/**`、`server/src/agent/**`、`server/src/runtime/**`）。
- 步骤 7/8 需要一个跑着的后端；`smoke.ts` 用离线模式跑（无 Key）时事件序列里不会有 `tool`，这是正常的。
- 冒烟会新建项目并在结束时删除；中断留下的项目/工作目录要手工清（控制台「删除」或 `DELETE /api/projects/:id`）。
- 任何一步失败都要连同「哪条命令、什么输出」一起记录，不要跳过或用 `|| true` 掩盖。
- 技能改动也要过步骤 4：`description` 必须同时写清「什么时候用」与「不适用于什么」，正文含 `结构 / 不变量 / 验证` 三节且 ≤60 行。

## 验证

```powershell
node scripts/check-skills.mjs         # 输出每个技能的行数与校验结论，全部 OK 才算通过
```

收尾时确认 `git status` 里没有 `var/`、`node_modules/`、`dist/` 之类产物被暂存（`.gitignore` 已覆盖）。