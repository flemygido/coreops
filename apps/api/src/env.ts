// Validates all required environment variables at startup.
// The app will refuse to start rather than fail silently mid-request.

interface Env {
  NODE_ENV: string
  PORT: number
  LOG_LEVEL: string
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  SUPABASE_SERVICE_ROLE_KEY: string
  ENCRYPTION_KEY: string
  ANTHROPIC_API_KEY: string | undefined
  OPENAI_API_KEY: string | undefined
  // Ranked "provider:model" candidates for the follow-up-draft AI use, most
  // affordable first — see apps/api/src/llm/model-ranking.ts and ADR-0005 Amendment.
  LLM_RANKING_FOLLOW_UP_DRAFT: string
  // Cron expression for the daily receivables workflow job (default: 7am IST = 1:30 UTC)
  WORKFLOW_CRON: string
  // Origin(s) the dashboard runs on — added to CORS allow-list (comma-separated)
  DASHBOARD_ORIGIN: string
  // Daily LLM spend cap per business in USD. Drafting aborts if exceeded.
  LLM_DAILY_BUDGET_USD: number
  // Days to keep terminal follow-ups (sent/skipped/failed) before retention purge.
  RETENTION_DAYS: number
  // Feature flag: when true, routes WhatsApp sends through the real Cloud API connector.
  // Requires WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in connected_accounts credentials.
  WHATSAPP_ENABLED: boolean
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
    ENCRYPTION_KEY: required('ENCRYPTION_KEY'),
    // Optional at startup — the app can run without LLM features configured.
    // Ranking resolution throws when actually invoked without any matching
    // key, not at boot (see model-ranking.ts).
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    LLM_RANKING_FOLLOW_UP_DRAFT:
      process.env.LLM_RANKING_FOLLOW_UP_DRAFT ??
      'openai:gpt-5-nano,openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001,anthropic:claude-sonnet-4-6',
    WORKFLOW_CRON: process.env.WORKFLOW_CRON ?? '30 1 * * *',
    DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3001',
    LLM_DAILY_BUDGET_USD: parseFloat(process.env.LLM_DAILY_BUDGET_USD ?? '1.00'),
    RETENTION_DAYS: parseInt(process.env.RETENTION_DAYS ?? '365', 10),
    WHATSAPP_ENABLED: process.env.WHATSAPP_ENABLED === 'true',
  }
}

export type { Env }
