// Runs once in the main Vitest process before workers are spawned.
// Workers inherit process.env from main, so changes here are visible to
// every test file when their modules first evaluate (e.g. describe.skipIf checks).
//
// Priority order:
//   1. Existing process.env values win (CI sets SUPABASE_* via `supabase status`)
//   2. Non-empty values from .env fill in what CI left blank (ENCRYPTION_KEY, etc.)
//   3. When SUPABASE_URL is still missing/empty after .env, call `supabase status`
//      so local dev runs automatically get a live DB without manual env setup.
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

export async function setup() {
  const dir = dirname(fileURLToPath(import.meta.url))

  // 1. Load .env (skip empty values; never overwrite existing env)
  const envPath = resolve(dir, '../../.env')
  if (existsSync(envPath)) {
    const raw = readFileSync(envPath, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
      if (key && val && !(key in process.env)) {
        process.env[key] = val
      }
    }
  }

  // 2. If SUPABASE_URL is still absent/empty, auto-detect from local Supabase.
  //    This lets `npm test` just work in local dev without any manual env setup.
  //    Silently no-ops if Supabase isn't running (integration tests will skip).
  if (!process.env.SUPABASE_URL) {
    try {
      const raw = execSync('npx supabase status --output json', {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: resolve(dir, '../..'),
      }).toString()
      const status = JSON.parse(raw)
      if (!process.env.SUPABASE_URL) process.env.SUPABASE_URL = status.API_URL ?? ''
      if (!process.env.SUPABASE_ANON_KEY) process.env.SUPABASE_ANON_KEY = status.ANON_KEY ?? ''
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
        process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY ?? ''
    } catch {
      // Supabase not running locally — integration tests will skip gracefully
    }
  }
}
