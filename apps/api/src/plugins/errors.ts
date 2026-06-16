import type { FastifyError, FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

// Typed application errors — throw these from route handlers.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, 'NOT_FOUND', `${resource} ${id} not found`)
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, 'VALIDATION_ERROR', message)
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message)
  }
}

// Fastify plugin: centralised error handler → consistent JSON error body.
async function errorsPlugin(app: FastifyInstance) {
  app.setErrorHandler((error: FastifyError | AppError, req, reply) => {
    if (error instanceof AppError) {
      req.log.warn({ code: error.code, message: error.message }, 'app error')
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      })
    }

    // Fastify validation errors
    if (error.validation) {
      req.log.warn({ validation: error.validation }, 'validation error')
      return reply.status(400).send({
        error: { code: 'VALIDATION_ERROR', message: error.message },
      })
    }

    req.log.error({ err: error }, 'unhandled error')
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })
}

export default fp(errorsPlugin, { name: 'errors' })
