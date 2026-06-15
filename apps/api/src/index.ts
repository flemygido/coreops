import Fastify from 'fastify'

export function createApp() {
  const app = Fastify({ logger: true })

  app.get('/health', async () => ({ status: 'ok', service: 'coreops-api' }))

  return app
}
