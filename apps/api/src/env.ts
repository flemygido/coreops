// Validates all required environment variables at startup.
// The app will refuse to start rather than fail silently mid-request.

interface Env {
  NODE_ENV: string
  PORT: number
  LOG_LEVEL: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SUPABASE_JWT_SECRET: string
  ENCRYPTION_KEY: string
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable: ${name}`)
  return v
}

export function loadEnv(): Env {
  return {
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    PORT: parseInt(process.env.PORT ?? '3000', 10),
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    SUPABASE_URL: required('SUPABASE_URL'),
    SUPABASE_ANON_KEY: required('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
    SUPABASE_JWT_SECRET: required('SUPABASE_JWT_SECRET'),
    ENCRYPTION_KEY: required('ENCRYPTION_KEY'),
  }
}

export type { Env }
