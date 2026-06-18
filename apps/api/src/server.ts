import { loadEnv } from './env.js'
import { createApp } from './app.js'
import { startDailyWorkflow } from './jobs/daily-workflow.js'
import { startRetentionJob } from './jobs/retention.js'
import { startDsoJob } from './jobs/dso.js'

const env = loadEnv()
const app = await createApp(env)

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
  startDailyWorkflow(app)
  startRetentionJob(app)
  startDsoJob(app)
  app.log.info({ cron: env.WORKFLOW_CRON }, 'Daily workflow job scheduled')
  app.log.info({ cron: '0 2 * * 0', retentionDays: env.RETENTION_DAYS }, 'Retention job scheduled')
  app.log.info({ cron: '0 3 * * 0' }, 'DSO snapshot job scheduled')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
