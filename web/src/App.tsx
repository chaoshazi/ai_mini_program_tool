import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api/client'
import type { FileEntryDTO, PreviewInfoDTO, ProjectDTO } from './api/types'
import { ChatPanel } from './components/ChatPanel'
import { FilesPanel } from './components/FilesPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { ProjectSidebar } from './components/ProjectSidebar'
import { Button, Panel, StatusDot } from './components/ui'
import { useProjects } from './hooks/useProjects'
import { useRunStream } from './hooks/useRunStream'

type Tab = 'preview' | 'files'

export default function App(): ReactNode {
  const { projects, health, error: projectsError, refresh, create, remove } = useProjects()
  const [selected, setSelected] = useState<ProjectDTO | null>(null)
  const [tab, setTab] = useState<Tab>('preview')
  const [preview, setPreview] = useState<PreviewInfoDTO | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [files, setFiles] = useState<FileEntryDTO[]>([])
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [fileLoading, setFileLoading] = useState(false)

  const projectId = selected?.id ?? null
  const stream = useRunStream(projectId)

  const loadFiles = useCallback(async (id: string) => {
    try {
      setFiles(await api.listFiles(id))
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadMessages = stream.loadMessages

  useEffect(() => {
    if (!selected) {
      setFiles([])
      setFilePath(null)
      setFileContent('')
      setPreview(null)
      return
    }
    setFilePath(null)
    setFileContent('')
    void loadFiles(selected.id)
    void loadMessages()
    void api
      .getPreview(selected.id)
      .then((info) => setPreview(info.status === 'stopped' ? null : info))
      .catch(() => setPreview(null))
  }, [selected, loadFiles, loadMessages])

  // 一轮生成结束后刷新文件列表；done 事件里带 previewUrl，直接同步状态。
  useEffect(() => {
    const last = stream.events[stream.events.length - 1]
    if (!last || !projectId) return
    if (last.envelope.type === 'done') {
      void loadFiles(projectId)
      void api
        .getPreview(projectId)
        .then((info) => setPreview(info.status === 'stopped' ? null : info))
        .catch(() => undefined)
      void refresh()
    }
    if (last.envelope.type === 'preview') {
      const data = last.envelope.data as { status?: string; url?: string | null; message?: string }
      if (data.url) {
        setPreview((current) => ({
          projectId,
          status: (data.status as PreviewInfoDTO['status']) ?? 'running',
          url: data.url as string,
          clientPort: current?.clientPort ?? 0,
          apiPort: current?.apiPort ?? 0,
          startedAt: current?.startedAt ?? new Date().toISOString(),
        }))
      }
    }
  }, [stream.events, projectId, loadFiles])

  const openFile = useCallback(
    async (path: string) => {
      if (!projectId) return
      setFilePath(path)
      setFileLoading(true)
      try {
        const file = await api.readFile(projectId, path)
        setFileContent(file.content)
      } catch (err) {
        setFileContent(err instanceof Error ? err.message : String(err))
      } finally {
        setFileLoading(false)
      }
    },
    [projectId],
  )

  const startPreview = useCallback(async () => {
    if (!projectId) return
    setBusy(true)
    setNotice('正在启动预览：会同时拉起 client(H5) 与 server，首次需要装依赖，可能要一两分钟…')
    try {
      setPreview(await api.startPreview(projectId))
      setNotice(null)
      setTab('preview')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      void refresh()
    }
  }, [projectId, refresh])

  const setApiOrigin = useCallback(
    async (value: string | null) => {
      if (!projectId) return
      setBusy(true)
      try {
        const updated = await api.setApiOrigin(projectId, value)
        setSelected(updated)
        setNotice(
          updated.apiOrigin
            ? '已把接口指向 ' + updated.apiOrigin + '：点「重启」后生效。'
            : '已改回使用生成工程自带的 Node 后端：点「重启」后生效。',
        )
        void refresh()
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [projectId, refresh],
  )

  const stopPreview = useCallback(async () => {
    if (!projectId) return
    setBusy(true)
    try {
      await api.stopPreview(projectId)
      setPreview(null)
      setNotice(null)
      void refresh()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [projectId, refresh])

  const exportProject = useCallback(async () => {
    if (!projectId) return
    setBusy(true)
    try {
      const result = await api.exportProject(projectId)
      setNotice('已导出 ' + result.filename + '（' + result.entries + ' 个文件），开始下载…')
      window.location.href = result.url
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [projectId])

  const runningLabel = useMemo(() => (stream.running ? '生成中…' : '空闲'), [stream.running])

  return (
    <div className="flex h-screen w-screen bg-slate-900 text-slate-100">
      <ProjectSidebar
        projects={projects}
        health={health}
        selectedId={projectId}
        onSelect={(project) => {
          setSelected(project)
          stream.reset()
        }}
        onCreate={async (name, description) => {
          const created = await create(name, description)
          if (created) {
            setSelected(created)
            stream.reset()
            setTab('preview')
          }
        }}
        onDelete={async (id) => {
          await remove(id)
          if (id === projectId) setSelected(null)
        }}
      />

      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-2.5">
          <h1 className="text-sm font-semibold">miniwechat · AI 小程序开发工具</h1>
          {selected && (
            <span className="flex items-center gap-2 rounded-md bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
              <StatusDot status={stream.running ? 'generating' : selected.status} />
              {selected.name}
              <span className="text-slate-500">· {selected.mode === 'llm' ? '模型生成' : '离线脚手架'}</span>
            </span>
          )}
          <span className="ml-auto text-[11px] text-slate-500">
            {health ? '后端 9320 · schema v' + health.schemaVersion + ' · ' + runningLabel : '连接后端中…'}
          </span>
          <Button onClick={() => void refresh()}>刷新</Button>
        </header>

        {(notice ?? projectsError) && (
          <p className="border-b border-amber-900/50 bg-amber-950/30 px-4 py-1.5 text-[11px] text-amber-200">
            {projectsError ?? notice}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <Panel
            title={tab === 'preview' ? '预览' : '生成的文件'}
            actions={
              <>
                <Button kind={tab === 'preview' ? 'primary' : 'ghost'} onClick={() => setTab('preview')}>
                  预览
                </Button>
                <Button kind={tab === 'files' ? 'primary' : 'ghost'} onClick={() => setTab('files')}>
                  文件（{files.length}）
                </Button>
              </>
            }
          >
            {!selected ? (
              <p className="px-3 py-10 text-center text-xs text-slate-500">左侧新建或选择一个项目</p>
            ) : tab === 'preview' ? (
              <PreviewPanel
                preview={preview}
                busy={busy}
                message={notice}
                hasFiles={files.length > 0}
                apiOrigin={selected.apiOrigin}
                onSetApiOrigin={(value) => void setApiOrigin(value)}
                onStart={() => void startPreview()}
                onStop={() => void stopPreview()}
                onRefresh={() => void startPreview()}
                onExport={() => void exportProject()}
              />
            ) : (
              <FilesPanel
                files={files}
                selectedPath={filePath}
                content={fileContent}
                loading={fileLoading}
                onSelect={(path) => void openFile(path)}
              />
            )}
          </Panel>
        </div>
      </main>

      <ChatPanel
        events={stream.events}
        messages={stream.messages}
        running={stream.running}
        liveText={stream.liveText}
        error={stream.error}
        disabled={!selected}
        onSend={(content) => void stream.send(content)}
      />
    </div>
  )
}