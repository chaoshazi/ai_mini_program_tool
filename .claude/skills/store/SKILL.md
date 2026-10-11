---
name: store
description: 改 D:\miniwechat 的存储与迁移时使用：SQLite 表结构与迁移步骤、文件内容落盘约定、种子数据、var/ 目录清理。不适用于改生成工程自带的存储（那是模板，看 templates）。
---

# 存储与迁移

## 结构

- `server/src/store/db.ts`：`Store`（`node:sqlite` 的 `DatabaseSync`）+ `MIGRATIONS` 数组 + `schemaVersion()`。
- `server/src/store/types.ts`：实体类型（Project / Message / RunRecord / FileRecord / BuildReport…）。
- 库文件：`var/miniwechat.db`（WAL 模式，`foreign_keys = ON`）；日志 `var/logs/`；导出包 `var/exports/`。

| 表 | 关键列 |
| --- | --- |
| `projects` | id / name / description / status / mode / preview_status / preview_url / created_at / updated_at |
| `messages` | id / project_id / role / content / run_id / created_at |
| `runs` | id / project_id / status / mode / summary / files_json / build_json / error / started_at / finished_at |
| `files` | (project_id, path) 主键 / size / hash / updated_at —— **只存索引，内容在磁盘** |
| `schema_migrations` | version / applied_at |

## 不变量

- 迁移只追加：`MIGRATIONS` 数组末尾加新元素，绝不允许改已发布的 SQL；执行记录写进 `schema_migrations`，
  每个版本在事务里执行（失败 ROLLBACK）。`schemaVersion()` 是 `/api/health` 与测试的断言点。
- 文件内容永远不进库：`replaceFileIndex` 写 `{path,size,hash}`，内容由 `Workspace` 落在 `var/workspaces/<id>/`。
- 删除项目要显式级联清理（`deleteProject` 先删 files/runs/messages 再删 projects），同时停预览、清工作目录。
- 无 `better-sqlite3`、无原生编译：Node 内置 `node:sqlite`。启动脚本带 `--disable-warning=ExperimentalWarning`（见 dev 技能）。
- 运行期目录全部在 `var/`（已被 gitignore）；`npm run clean` 只删生成物，不碰源码与 `var/miniwechat.db` 之外的东西。

## 验证

```powershell
npm run test --workspace server                 # store.test.ts：迁移可重开、CRUD、级联删除
node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('var/miniwechat.db');console.log(d.prepare('select version from schema_migrations').all())"
```

加迁移后：先备份 `var/miniwechat.db`，再用旧库启动一次，确认 `schemaVersion()` 升到新版本且旧数据仍在。