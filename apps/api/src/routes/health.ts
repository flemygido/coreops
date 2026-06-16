import { Type } from '@sinclair/typebox'
import type { FastifyPluginAsync } from 'fastify'

const HealthResponse = Type.Object({
  status: Type.Literal('ok'),
  version: Type.String(),
  uptime: Type.Number(),
})

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        response: { 200: HealthResponse },
        tags: ['system'],
      },
    },
    async () => ({
      status: 'ok' as const,
      version: '0.1.0',
      uptime: process.uptime(),
    })
  )
}
