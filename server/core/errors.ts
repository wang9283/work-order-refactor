import type { ApiErrorCode } from '../../packages/contracts/src'

export class AppError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly details?: unknown

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'VALIDATION_FAILED', message, details)
  }

  static unauthorized(message = '请先登录'): AppError {
    return new AppError(401, 'AUTH_REQUIRED', message)
  }

  static invalidCredentials(): AppError {
    return new AppError(401, 'INVALID_CREDENTIALS', '用户名或密码错误')
  }

  static forbidden(message = '当前账号无权执行此操作'): AppError {
    return new AppError(403, 'FORBIDDEN', message)
  }

  static notFound(entity = '数据'): AppError {
    return new AppError(404, 'NOT_FOUND', `${entity}不存在`)
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'CONFLICT', message, details)
  }

  static referenceConflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'REFERENCE_CONFLICT', message, details)
  }

  static revisionConflict(): AppError {
    return new AppError(409, 'REVISION_CONFLICT', '该记录已被其他人更新，请刷新后重试')
  }

  static stateConflict(message: string): AppError {
    return new AppError(409, 'STATE_CONFLICT', message)
  }
}
