import { useState, type ReactNode } from 'react'
import type { HealthDTO, ProjectDTO } from '../api/types'
import { Button, Empty, StatusDot } from './ui'

export function ProjectSidebar({
  projects,
  health,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: {
  projects: ProjectDTO[]
  health: HealthDTO | null
  selectedId: string | null
  onSelect: (project: ProjectDTO) => void
  onCreate: (name: string, description: string) => void
  onDelete: (id: string) => void
}): ReactNode {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 border-r border-slate-800 bg-slate-950/60 p-3">
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
        <h2 className="text-xs font-semibold tracking-wide text-slate-300 uppercase">新建项目</h2>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="项目名，例如 待办清单"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-600"
        />
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="一句话描述（可选）"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-600"
        />
        <Button
          kind="primary"
          className="mt-2 w-full"
          disabled={name.trim().length === 0}
          onClick={() => {
            onCreate(name.trim(), description.trim())
            setName('')
            setDescription('')
          }}
        >
          创建
        </Button>
        {health && !health.llm.enabled && (
          <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
            未配置 LLM_API_KEY：生成走离线脚手架（只产出模板示例工程），配置 .env 后可走模型。
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-800 bg-slate-900/60">
        <header className="border-b border-slate-800 px-3 py-2 text-xs font-semibold tracking-wide text-slate-300 uppercase">
          项目（{projects.length}）
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {projects.length === 0 ? (
            <Empty>还没有项目，先在上面创建一个</Empty>
          ) : (
            <ul className="flex flex-col gap-1">
              {projects.map((project) => (
                <li key={project.id}>
                  <div
                    className={
                      'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs transition ' +
                      (project.id === selectedId ? 'bg-emerald-950/60 text-emerald-100' : 'text-slate-300 hover:bg-slate-800/60')
                    }
                    onClick={() => onSelect(project)}
                  >
                    <StatusDot status={project.status === 'generating' ? 'generating' : project.previewStatus} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{project.name}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {project.mode === 'llm' ? '模型生成' : '离线脚手架'} · {project.previewStatus}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="hidden shrink-0 text-[11px] text-rose-300 group-hover:block"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDelete(project.id)
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  )
}