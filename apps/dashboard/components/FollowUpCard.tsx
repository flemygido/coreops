'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  id: string
  status: string
  draftedText: string
  invoiceNumber: string
  outstanding: number
  customerName: string
  customerPhone: string | null
  sentAt: string | null
  approvedAt: string | null
  createdAt: string
}

const STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  draft: { label: 'Needs review', classes: 'bg-yellow-100 text-yellow-800' },
  approved: { label: 'Approved', classes: 'bg-blue-100 text-blue-800' },
  sent: { label: 'Sent', classes: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', classes: 'bg-red-100 text-red-800' },
  skipped: { label: 'Skipped', classes: 'bg-gray-100 text-gray-500' },
}

function formatRupees(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

export default function FollowUpCard({
  id,
  status,
  draftedText,
  invoiceNumber,
  outstanding,
  customerName,
  customerPhone,
  sentAt,
  approvedAt,
  createdAt,
}: Props) {
  const router = useRouter()
  const [currentStatus, setCurrentStatus] = useState(status)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const badge = STATUS_LABELS[currentStatus] ?? {
    label: currentStatus,
    classes: 'bg-gray-100 text-gray-700',
  }

  async function getToken() {
    const supabase = createClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) throw new Error('Not signed in')
    return session.access_token
  }

  async function patchStatus(newStatus: string) {
    setLoading(newStatus)
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/follow-ups/${id}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error?.message ?? body.message ?? `Failed: ${res.status}`)
      }
      setCurrentStatus(newStatus)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(null)
    }
  }

  async function sendMessage() {
    setLoading('send')
    setError(null)
    try {
      const token = await getToken()
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/v1/follow-ups/${id}/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error?.message ?? body.message ?? `Failed: ${res.status}`)
      }
      const data = (await res.json()) as { ok: boolean; message: string }
      if (!data.ok) {
        throw new Error(data.message ?? 'Message failed to send')
      }
      setCurrentStatus('sent')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(null)
    }
  }

  const isLoading = loading !== null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{customerName}</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.classes}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            {invoiceNumber} · {formatRupees(outstanding)} outstanding
            {customerPhone && <> · {customerPhone}</>}
          </p>
        </div>
        <span className="text-xs text-gray-400 shrink-0">
          {new Date(createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
        </span>
      </div>

      {/* Drafted message */}
      <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-700 leading-relaxed border border-gray-100">
        {draftedText}
      </div>

      {/* Sent / approved timestamps */}
      {(sentAt || approvedAt) && (
        <p className="text-xs text-gray-400">
          {sentAt && (
            <>
              Sent{' '}
              {new Date(sentAt).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </>
          )}
          {approvedAt && !sentAt && (
            <>
              Approved{' '}
              {new Date(approvedAt).toLocaleString('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </>
          )}
        </p>
      )}

      {/* Error */}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {/* Actions */}
      {currentStatus === 'draft' && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => patchStatus('approved')}
            disabled={isLoading}
            className="flex-1 bg-indigo-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading === 'approved' ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => patchStatus('skipped')}
            disabled={isLoading}
            className="flex-1 bg-white text-gray-600 text-sm font-medium rounded-lg px-4 py-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {loading === 'skipped' ? 'Skipping…' : 'Skip'}
          </button>
        </div>
      )}

      {currentStatus === 'approved' && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={sendMessage}
            disabled={isLoading}
            className="flex-1 bg-green-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {loading === 'send' ? 'Sending…' : 'Send on WhatsApp'}
          </button>
          <button
            onClick={() => patchStatus('skipped')}
            disabled={isLoading}
            className="bg-white text-gray-600 text-sm font-medium rounded-lg px-3 py-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  )
}
