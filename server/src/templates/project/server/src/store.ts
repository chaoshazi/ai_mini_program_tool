// 待办存储：内存数组 + 可选 JSON 文件落盘（换数据库时只改这一层）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Todo {
  id: number
  title: string
  done: boolean
  createdAt: string
}

export interface Store {
  list(): Todo[]
  get(id: number): Todo | undefined
  create(title: string): Todo
  update(id: number, patch: { title?: string; done?: boolean }): Todo | undefined
  remove(id: number): boolean
  count(): number
}

export interface StoreOptions {
  /** null 表示纯内存，不落盘。 */
  file: string | null
}

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveFile(file: string): string {
  return path.isAbsolute(file) ? file : path.join(serverRoot, file)
}

export function createStore(options: StoreOptions): Store {
  const todos: Todo[] = []
  let nextId = 1
  const file = options.file ? resolveFile(options.file) : null

  if (file && fs.existsSync(file)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { todos?: Todo[]; nextId?: number }
      todos.push(...(parsed.todos ?? []))
      nextId = parsed.nextId ?? todos.reduce((max, item) => Math.max(max, item.id), 0) + 1
    } catch (error) {
      console.warn('读取数据文件失败，使用空数据启动：' + (error as Error).message)
    }
  }

  const persist = (): void => {
    if (!file) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ todos, nextId }, null, 2), 'utf8')
  }

  return {
    list: () => [...todos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    get: (id) => todos.find((item) => item.id === id),
    create(title) {
      const todo: Todo = { id: nextId, title, done: false, createdAt: new Date().toISOString() }
      nextId += 1
      todos.push(todo)
      persist()
      return todo
    },
    update(id, patch) {
      const todo = todos.find((item) => item.id === id)
      if (!todo) return undefined
      if (typeof patch.title === 'string') todo.title = patch.title
      if (typeof patch.done === 'boolean') todo.done = patch.done
      persist()
      return todo
    },
    remove(id) {
      const index = todos.findIndex((item) => item.id === id)
      if (index < 0) return false
      todos.splice(index, 1)
      persist()
      return true
    },
    count: () => todos.length,
  }
}