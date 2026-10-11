// 存储使用 Node 内置 node:sqlite（DatabaseSync），零原生依赖，API 与 better-sqlite3 基本一致。
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { BuildReport, FileChange, GenerationMode, Message, Project, RunRecord, RunStatus } from './types.js'

/** 迁移按版本号顺序执行，已执行的版本记录在 schema_migrations。 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    mode TEXT NOT NULL DEFAULT 'offline',
    preview_status TEXT NOT NULL DEFAULT 'stopped',
    preview_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    run_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_project ON messages(project_id, created_at);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    mode TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    files_json TEXT NOT NULL DEFAULT '[]',
    build_json TEXT,
    error TEXT,
    started_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX idx_runs_project ON runs(project_id, started_at);
  CREATE TABLE files (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    hash TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (project_id, path)
  );
  `,
  // 迁移 2：接入自己的后端（例如 PHP 写的接口）时，给项目记一个外部 API 地址
  `
  ALTER TABLE projects ADD COLUMN api_origin TEXT;
  `,
]

type Row = Record<string, unknown>

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function projectFromRow(row: Row): Project {
  return {
    id: asString(row.id),
    name: asString(row.name),
    description: asString(row.description),
    status: asString(row.status, 'draft') as Project['status'],
    mode: asString(row.mode, 'offline') as GenerationMode,
    previewStatus: asString(row.preview_status, 'stopped') as Project['previewStatus'],
    previewUrl: asNullableString(row.preview_url),
    apiOrigin: asNullableString(row.api_origin),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  }
}

function messageFromRow(row: Row): Message {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    role: asString(row.role, 'user') as Message['role'],
    content: asString(row.content),
    runId: asNullableString(row.run_id),
    createdAt: asString(row.created_at),
  }
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function runFromRow(row: Row): RunRecord {
  return {
    id: asString(row.id),
    projectId: asString(row.project_id),
    status: asString(row.status, 'running') as RunStatus,
    mode: asString(row.mode, 'offline') as GenerationMode,
    summary: asString(row.summary),
    files: parseJson<FileChange[]>(row.files_json, []),
    build: parseJson<BuildReport | null>(row.build_json, null),
    error: asNullableString(row.error),
    startedAt: asString(row.started_at),
    finishedAt: asNullableString(row.finished_at),
  }
}

export class Store {
  private readonly db: DatabaseSync

  constructor(readonly dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);')
    const applied = new Set(
      this.db
        .prepare('SELECT version FROM schema_migrations')
        .all()
        .map((row) => Number((row as Row).version)),
    )
    MIGRATIONS.forEach((sql, index) => {
      const version = index + 1
      if (applied.has(version)) return
      this.db.exec('BEGIN')
      try {
        this.db.exec(sql)
        this.db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    })
  }

  /** 迁移版本号，供 /api/health 与测试断言使用。 */
  schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as Row | undefined
    return Number(row?.v ?? 0)
  }

  close(): void {
    this.db.close()
  }

  // --- projects ---

  createProject(project: Project): Project {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, description, status, mode, preview_status, preview_url, api_origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.description,
        project.status,
        project.mode,
        project.previewStatus,
        project.previewUrl,
        project.apiOrigin,
        project.createdAt,
        project.updatedAt,
      )
    return project
  }

  listProjects(): Project[] {
    return this.db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all()
      .map((row) => projectFromRow(row as Row))
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
    return row ? projectFromRow(row) : null
  }

  updateProject(id: string, patch: Partial<Project>): Project | null {
    const current = this.getProject(id)
    if (!current) return null
    const next: Project = { ...current, ...patch, updatedAt: new Date().toISOString() }
    this.db
      .prepare(
        `UPDATE projects SET name = ?, description = ?, status = ?, mode = ?, preview_status = ?, preview_url = ?, api_origin = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.name,
        next.description,
        next.status,
        next.mode,
        next.previewStatus,
        next.previewUrl,
        next.apiOrigin,
        next.updatedAt,
        id,
      )
    return next
  }

  deleteProject(id: string): boolean {
    this.db.prepare('DELETE FROM files WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM runs WHERE project_id = ?').run(id)
    this.db.prepare('DELETE FROM messages WHERE project_id = ?').run(id)
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  // --- messages ---

  addMessage(message: Message): Message {
    this.db
      .prepare('INSERT INTO messages (id, project_id, role, content, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(message.id, message.projectId, message.role, message.content, message.runId, message.createdAt)
    return message
  }

  listMessages(projectId: string, limit = 200): Message[] {
    return this.db
      .prepare('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC LIMIT ?')
      .all(projectId, limit)
      .map((row) => messageFromRow(row as Row))
  }

  // --- runs ---

  createRun(run: RunRecord): RunRecord {
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, status, mode, summary, files_json, build_json, error, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.projectId,
        run.status,
        run.mode,
        run.summary,
        JSON.stringify(run.files),
        run.build ? JSON.stringify(run.build) : null,
        run.error,
        run.startedAt,
        run.finishedAt,
      )
    return run
  }

  finishRun(
    id: string,
    patch: { status: RunStatus; summary?: string; files?: FileChange[]; build?: BuildReport | null; error?: string | null },
  ): void {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined
    if (!row) return
    const current = runFromRow(row)
    this.db
      .prepare('UPDATE runs SET status = ?, summary = ?, files_json = ?, build_json = ?, error = ?, finished_at = ? WHERE id = ?')
      .run(
        patch.status,
        patch.summary ?? current.summary,
        JSON.stringify(patch.files ?? current.files),
        JSON.stringify(patch.build ?? current.build),
        patch.error === undefined ? current.error : patch.error,
        new Date().toISOString(),
        id,
      )
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined
    return row ? runFromRow(row) : null
  }

  listRuns(projectId: string, limit = 20): RunRecord[] {
    return this.db
      .prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(projectId, limit)
      .map((row) => runFromRow(row as Row))
  }

  // --- files（索引，内容在磁盘） ---

  replaceFileIndex(projectId: string, entries: Array<{ path: string; size: number; hash: string }>): void {
    const now = new Date().toISOString()
    this.db.prepare('DELETE FROM files WHERE project_id = ?').run(projectId)
    const insert = this.db.prepare('INSERT INTO files (project_id, path, size, hash, updated_at) VALUES (?, ?, ?, ?, ?)')
    for (const entry of entries) insert.run(projectId, entry.path, entry.size, entry.hash, now)
  }

  listFileIndex(projectId: string): Array<{ path: string; size: number; hash: string }> {
    return this.db
      .prepare('SELECT path, size, hash FROM files WHERE project_id = ? ORDER BY path ASC')
      .all(projectId)
      .map((row) => {
        const r = row as Row
        return { path: asString(r.path), size: Number(r.size), hash: asString(r.hash) }
      })
  }
}