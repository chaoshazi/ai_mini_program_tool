// Fastify 组装：CORS + 统一错误体 + 业务路由 + 预览代理 + 控制台静态托管。
import fs from 'node:fs'
import path from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { ApiCode, ApiError } from './util/errors.js'
import { registerApiRoutes, type ApiDeps } from './api/routes.js'
import { registerPreviewProxy } from './api/proxy.js'

export function buildApp(deps: ApiDeps): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 4 * 1024 * 1024,
    trustProxy: true,
  })

  app.register(cors, { origin: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] })

  // 允许 content-type: application/json 但空 body 的请求（例如 POST /export 无参数），
  // Fastify 默认会直接报 "Body cannot be empty"。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, payload, done) => {
    const text = typeof payload === 'string' ? payload.trim() : ''
    if (text === '') {
      done(null, {})
      return
    }
    try {
      done(null, JSON.parse(text))
    } catch (error) {
      done(ApiError.badRequest('请求体不是合法 JSON：' + (error as Error).message), undefined)
    }
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      deps.logger.warn('接口报错 ' + request.method + ' ' + request.url + '：' + error.message)
      reply.code(error.status).send({ code: error.code, message: error.message, detail: error.detail })
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    deps.logger.error('未处理异常 ' + request.method + ' ' + request.url + '：' + message)
    reply.code(500).send({ code: ApiCode.INTERNAL, message, detail: null })
  })

  registerApiRoutes(app, deps)
  registerPreviewProxy(app, deps.previews, deps.logger)

  // 控制台构建产物由工具后端托管（npm run build 之后直接访问 9320 即可）。
  const webDist = deps.config.webDistDir
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false })
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? ''
      if (url.startsWith('/api/') || url.startsWith('/preview/')) {
        reply.code(404).send({ code: ApiCode.NOT_FOUND, message: '接口或预览不存在：' + url, detail: null })
        return
      }
      reply.type('text/html; charset=utf-8').send(fs.readFileSync(path.join(webDist, 'index.html')))
    })
  } else {
    app.setNotFoundHandler((request, reply) => {
      const url = request.raw.url ?? ''
      const hint = url.startsWith('/api/') || url.startsWith('/preview/') ? '接口或预览不存在：' + url : '控制台尚未构建，请先运行 npm run dev:web 或 npm run build'
      reply.code(url.startsWith('/api/') ? 404 : 200).send({ code: ApiCode.NOT_FOUND, message: hint, detail: null })
    })
  }

  return app
}