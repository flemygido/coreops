'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface WorkflowResult {
  drafted: number
  skipped_already_pending: number
  failed: number
  errors: Array<{ invoice_id: string; message: string }>
}

export default function RunWorkflowButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<WorkflowResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runWorkflow() {
    setLoading(true)
    setResult(null)
    setError(null)

    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) throw new Error('Not signed in')

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/workflow/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.message ?? `Request failed: ${res.status}`)
      }

      const data = (await res.json()) as WorkflowResult
      setResult(data)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={runWorkflow}
        disabled={loading}
        className="inline-flex items-center gap-2 bg-indigo-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? (
          <>
            <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            Drafting follow-ups…
          </>
        ) : (
          'Run workflow'
        )}
      </button>

      {result && (
        <div className="text-xs text-right text-gray-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          ✓ {result.drafted} drafted · {result.skipped_already_pending} already pending
          {result.failed > 0 && (
            <>
              {' '}
              · <span className="text-red-600">{result.failed} failed</span>
            </>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
