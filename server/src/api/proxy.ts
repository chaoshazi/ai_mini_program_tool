// 预览反向代理：/preview/<projectId>/... 透传到该项目的 client dev server，
// /preview/<projectId>/api/... 透传到该项目的 Node 后端。HTTP 与 WebSocket 都走这里。
import http from 'node:http'
import type { FastifyInstance } from 'fastify'
import type { PreviewManager } from '../runtime/preview.js'
import { Logger } from '../util/logger.js'

const SKIP_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection'])

function stripHeaderPrefix(prefix: string): RegExp {
  return new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

export interface TargetResolution {
  origin: string
  pathWithQuery: string
}

export function resolveTarget(url: string, targets: { clientOrigin: string; apiOrigin: string }): TargetResolution {
  const match = /^\/preview\/([^/?#]+)/.exec(url)
  const prefix = match ? match[0] : ''
  const isApi = /^\/preview\/[^/?#]+\/api(\/|\?|$)/.test(url)
  if (isApi) {
    return { origin: targets.apiOrigin, pathWithQuery: url.replace(stripHeaderPrefix(prefix), '') || '/' }
  }
  return { origin: targets.clientOrigin, pathWithQuery: url }
}

function pickHeaders(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const out: http.IncomingHttpHeaders = {}
  for (const [key, value] of Object.entries(headers)) {
    if (SKIP_HEADERS.has(key.toLowerCase())) continue
    out[key] = value
  }
  return out
}

export function registerPreviewProxy(app: FastifyInstance, previews: PreviewManager, logger: Logger): void {
  app.register(async (scope) => {
    // 用 onRequest + hijack：交给 Node 原生流处理，Fastify 不解析 body、也不插手响应。
    scope.addHook('onRequest', (request, reply, done) => {
      const url = request.raw.url ?? ''
      const projectId = /^\/preview\/([^/?#]+)/.exec(url)?.[1]
      const targets = projectId ? previews.targets(projectId) : null
      if (!targets) {
        done()
        return
      }
      reply.hijack()
      forward(request.raw, reply.raw, resolveTarget(url, targets), logger)
      done()
    })

    // 预览未启动 / 项目不存在时仍然返回统一 JSON 错误体。
    const notRunning = (request: { params: unknown }, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
      const id = (request.params as { id?: string }).id ?? ''
      reply.code(404).send({
        code: 40401,
        message: '项目 ' + id + ' 的预览未运行，请先调用 POST /api/projects/' + id + '/preview',
        data: null,
      })
    }
    scope.all('/preview/:id', notRunning)
    scope.all('/preview/:id/*', notRunning)
  })

  // WebSocket（Vite HMR）走裸 server 的 upgrade 事件。
  app.server.on('upgrade', (req, socket, head) => {
    const url = req.url ?? ''
    const projectId = /^\/preview\/([^/?#]+)/.exec(url)?.[1]
    const targets = projectId ? previews.targets(projectId) : null
    if (!targets) {
      socket.destroy()
      return
    }
    const { origin, pathWithQuery } = resolveTarget(url, targets)
    const target = new URL(pathWithQuery, origin)
    const upstream = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...pickHeaders(req.headers), host: target.host, connection: 'Upgrade', upgrade: 'websocket' },
    })
    upstream.on('upgrade', (res, upstreamSocket, upstreamHead) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          Object.entries(res.headers)
            .map(([key, value]) => key + ': ' + String(value) + '\r\n')
            .join('') +
          '\r\n',
      )
      if (upstreamHead.length > 0) socket.write(upstreamHead)
      if (head.length > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(socket)
      socket.pipe(upstreamSocket)
      const cleanup = (): void => {
        upstreamSocket.destroy()
        socket.destroy()
      }
      upstreamSocket.on('error', cleanup)
      socket.on('error', cleanup)
      socket.on('close', cleanup)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  })
}

function forward(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  resolution: TargetResolution,
  logger: Logger,
): void {
  const target = new URL(resolution.pathWithQuery, resolution.origin)
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...pickHeaders(req.headers), host: target.host },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, pickHeaders(upstreamRes.headers))
      upstreamRes.pipe(res)
    },
  )
  upstream.on('error', (error: Error) => {
    logger.warn('预览代理失败：' + error.message, { url: resolution.pathWithQuery })
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    }
    res.end(JSON.stringify({ code: 50003, message: '预览上游不可用：' + error.message, data: null }))
  })
  req.pipe(upstream)
  req.on('aborted', () => upstream.destroy())
}