import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { HealthDTO, ProjectDTO } from '../api/types'

export interface ProjectsState {
  projects: ProjectDTO[]
  health: HealthDTO | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (name: string, description: string) => Promise<ProjectDTO | null>
  remove: (id: string) => Promise<void>
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<ProjectDTO[]>([])
  const [health, setHealth] = useState<HealthDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [list, healthInfo] = await Promise.all([api.listProjects(), api.health()])
      setProjects(list)
      setHealth(healthInfo)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(
    async (name: string, description: string) => {
      try {
        const created = await api.createProject(name, description)
        setProjects((current) => [created, ...current])
        return created
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return null
      }
    },
    [],
  )

  const remove = useCallback(async (id: string) => {
    try {
      await api.deleteProject(id)
      setProjects((current) => current.filter((project) => project.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return { projects, health, loading, error, refresh, create, remove }
}