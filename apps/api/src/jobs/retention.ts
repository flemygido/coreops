// Weekly retention cron job — purges terminal follow-ups beyond RETENTION_DAYS.
// Runs Sunday 02:00 UTC (low-traffic window, consistent with IST weekday mornings
// having the lowest traffic risk on Sunday nights).

import { Cron } from 'croner'
import type { FastifyInstance } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { purgeOldFollowUps } from '../services/retention.js'

export function startRetentionJob(app: FastifyInstance): Cron {
  const { env } = app

  // Sunday 02:00 UTC
  return new Cron('0 2 * * 0', { timezone: 'UTC', protect: true }, async () => {
    app.log.info({ job: 'retention' }, 'Starting retention purge')

    try {
      const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      const { data: businesses, error } = await admin.from('businesses').select('id')
      if (error) throw new Error(error.message)

      let totalDeleted = 0
      for (const biz of businesses ?? []) {
        const result = await purgeOldFollowUps(admin, biz.id as string, env.RETENTION_DAYS)
        if (result.error) {
          app.log.error({ job: 'retention', businessId: biz.id, err: result.error }, 'Purge failed')
        } else if (result.deleted > 0) {
          app.log.info({ job: 'retention', businessId: biz.id, deleted: result.deleted }, 'Purged')
          totalDeleted += result.deleted
        }
      }

      app.log.info({ job: 'retention', totalDeleted }, 'Retention purge complete')
    } catch (err) {
      app.log.error({ job: 'retention', err }, 'Retention job failed')
    }
  })
}
