import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import errorsPlugin from './plugins/errors.js'
import supabaseAdminPlugin from './plugins/supabase-admin.js'
import authPlugin from './plugins/auth.js'
import { healthRoutes } from './routes/health.js'
import { invoicesRoutes } from './routes/invoices.js'
import { customersRoutes } from './routes/customers.js'
import { briefingsRoutes } from './routes/briefings.js'
import { followUpsRoutes } from './routes/follow-ups.js'
import { receivablesRoutes } from './routes/receivables.js'
import { connectedAccountsRoutes } from './routes/connected-accounts.js'
import { workflowRoutes } from './routes/workflow.js'
import type { Env } from './env.js'

export async function createApp(env: Env) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
  })

  app.decorate('env', env)

  await app.register(helmet)
  const allowedOrigins = env.DASHBOARD_ORIGIN.split(',').map((o) => o.trim())
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
      cb(new Error('Not allowed by CORS'), false)
    },
    credentials: true,
  })
  await app.register(errorsPlugin)
  await app.register(supabaseAdminPlugin)
  await app.register(authPlugin)

  await app.register(healthRoutes)
  await app.register(invoicesRoutes, { prefix: '/v1' })
  await app.register(customersRoutes, { prefix: '/v1' })
  await app.register(briefingsRoutes, { prefix: '/v1' })
  await app.register(followUpsRoutes, { prefix: '/v1' })
  await app.register(receivablesRoutes, { prefix: '/v1' })
  await app.register(connectedAccountsRoutes, { prefix: '/v1' })
  await app.register(workflowRoutes, { prefix: '/v1' })

  return app
}
