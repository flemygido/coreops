// Weekly DSO snapshot job — records pilot success metrics for every business.
// Runs Sunday 03:00 UTC, one hour after the retention job (02:00 UTC).

import { Cron } from 'croner'
import type { FastifyInstance } from 'fastify'
import { createClient } from '@supabase/supabase-js'
import { recordDsoSnapshot } from '../services/dso.js'

export function startDsoJob(app: FastifyInstance): Cron {
  const { env } = app

  return new Cron('0 3 * * 0', { timezone: 'UTC', protect: true }, async () => {
    app.log.info({ job: 'dso-snapshot' }, 'Starting DSO snapshot job')

    try {
      const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      const { data: businesses, error } = await admin.from('businesses').select('id')
      if (error) throw new Error(error.message)

      for (const biz of businesses ?? []) {
        try {
          await recordDsoSnapshot(admin, biz.id as string)
          app.log.info({ job: 'dso-snapshot', businessId: biz.id }, 'Snapshot recorded')
        } catch (err) {
          app.log.error({ job: 'dso-snapshot', businessId: biz.id, err }, 'Snapshot failed')
        }
      }

      app.log.info({ job: 'dso-snapshot' }, 'DSO snapshot job complete')
    } catch (err) {
      app.log.error({ job: 'dso-snapshot', err }, 'DSO snapshot job failed')
    }
  })
}
