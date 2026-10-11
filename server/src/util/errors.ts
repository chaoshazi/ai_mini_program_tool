// 统一错误码：REST 与 SSE 共用同一份，控制台按 code 决定提示文案。
export const ApiCode = {
  OK: 0,
  BAD_REQUEST: 40001,
  NOT_FOUND: 40401,
  CONFLICT: 40901,
  PATH_VIOLATION: 42201,
  COMMAND_REJECTED: 42202,
  BUILD_FAILED: 50001,
  LLM_FAILED: 50002,
  PREVIEW_FAILED: 50003,
  INTERNAL: 59999,
} as const

export type ApiCodeValue = (typeof ApiCode)[keyof typeof ApiCode]

const DEFAULT_MESSAGE: Record<number, string> = {
  [ApiCode.OK]: 'ok',
  [ApiCode.BAD_REQUEST]: '请求参数不合法',
  [ApiCode.NOT_FOUND]: '资源不存在',
  [ApiCode.CONFLICT]: '资源状态冲突',
  [ApiCode.PATH_VIOLATION]: '路径越界，已拒绝',
  [ApiCode.COMMAND_REJECTED]: '命令不在白名单内，已拒绝',
  [ApiCode.BUILD_FAILED]: '构建校验失败',
  [ApiCode.LLM_FAILED]: '模型调用失败',
  [ApiCode.PREVIEW_FAILED]: '预览启动失败',
  [ApiCode.INTERNAL]: '服务内部错误',
}

export class ApiError extends Error {
  readonly code: number
  readonly status: number
  readonly detail: unknown

  constructor(code: number, message?: string, status = 400, detail: unknown = null) {
    super(message ?? DEFAULT_MESSAGE[code] ?? '未知错误')
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
  }

  static badRequest(message?: string, detail: unknown = null): ApiError {
    return new ApiError(ApiCode.BAD_REQUEST, message, 400, detail)
  }
  static notFound(message?: string): ApiError {
    return new ApiError(ApiCode.NOT_FOUND, message, 404)
  }
  static conflict(message?: string): ApiError {
    return new ApiError(ApiCode.CONFLICT, message, 409)
  }
  static pathViolation(message?: string, detail: unknown = null): ApiError {
    return new ApiError(ApiCode.PATH_VIOLATION, message, 403, detail)
  }
  static commandRejected(message?: string, detail: unknown = null): ApiError {
    return new ApiError(ApiCode.COMMAND_REJECTED, message, 403, detail)
  }
  static internal(message?: string, detail: unknown = null): ApiError {
    return new ApiError(ApiCode.INTERNAL, message, 500, detail)
  }
}

export function messageForCode(code: number): string {
  return DEFAULT_MESSAGE[code] ?? '未知错误'
}