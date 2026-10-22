import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, type ZodType } from 'zod'
import type { ApiErrorBody, PageMeta } from '../../packages/contracts/src'
import { AppError } from './errors'

export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error) {
    if (error instanceof ZodError) {
      throw AppError.badRequest('提交内容不符合要求', error.issues)
    }
    throw error
  }
}

export function success<T>(request: FastifyRequest, data: T, meta?: PageMeta): { data: T; meta?: PageMeta; requestId: string } {
  return { data, meta, requestId: request.id }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      const body: { error: ApiErrorBody } = {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      }
      return reply.status(error.status).send(body)
    }

    request.log.error({ err: error }, 'Unhandled request error')
    const body: { error: ApiErrorBody } = {
      error: {
        code: 'INTERNAL_ERROR',
        message: '服务暂时不可用',
        requestId: request.id,
      },
    }
    return reply.status(500).send(body)
  })
}

export function setRevisionHeader(reply: FastifyReply, revision: number): void {
  reply.header('X-Revision', String(revision))
}
