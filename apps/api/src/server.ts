import { loadEnv } from './env.js'
import { createApp } from './app.js'
import { startDailyWorkflow } from './jobs/daily-workflow.js'

const env = loadEnv()
const app = await createApp(env)

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  startDailyWorkflow(app)
  app.log.info({ cron: env.WORKFLOW_CRON }, 'Daily workflow job scheduled')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
