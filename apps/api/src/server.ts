import { loadEnv } from './env.js'
import { createApp } from './app.js'

const env = loadEnv()
const app = await createApp(env)

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
