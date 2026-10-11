// 接口约定：统一返回 { code, message, data }，code = 0 表示成功。
import type { Express, NextFunction, Request, Response } from 'express'
import type { Store } from './store.js'

function ok<T>(res: Response, data: T): void {
  res.json({ code: 0, message: 'ok', data })
}

function fail(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ code, message, data: null })
}

const startedAt = Date.now()

export function registerRoutes(app: Express, store: Store): void {
  app.get('/api/health', (_req, res) => {
    ok(res, {
      ok: true,
      uptime: (Date.now() - startedAt) / 1000,
      todos: store.count(),
      version: '1.0.0',
    })
  })

  app.get('/api/todos', (_req, res) => {
    ok(res, store.list())
  })

  app.post('/api/todos', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
    if (!title) {
      fail(res, 400, 40001, 'title 不能为空')
      return
    }
    ok(res, store.create(title))
  })

  app.patch('/api/todos/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      fail(res, 400, 40001, 'id 必须是整数')
      return
    }
    const patch: { title?: string; done?: boolean } = {}
    if (typeof req.body?.title === 'string') patch.title = req.body.title.trim()
    if (typeof req.body?.done === 'boolean') patch.done = req.body.done
    const updated = store.update(id, patch)
    if (!updated) {
      fail(res, 404, 40401, '待办 ' + id + ' 不存在')
      return
    }
    ok(res, updated)
  })

  app.delete('/api/todos/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!store.remove(id)) {
      fail(res, 404, 40401, '待办 ' + id + ' 不存在')
      return
    }
    ok(res, { id })
  })

  app.use((_req, res) => {
    fail(res, 404, 40401, '接口不存在')
  })

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('未处理异常：' + error.message)
    fail(res, 500, 59999, '服务内部错误：' + error.message)
  })
}