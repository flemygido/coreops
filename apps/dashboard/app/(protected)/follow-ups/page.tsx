import { createClient } from '@/lib/supabase/server'
import FollowUpCard from '@/components/FollowUpCard'

export const dynamic = 'force-dynamic'

interface FollowUp {
  id: string
  status: string
  drafted_text: string
  approved_at: string | null
  sent_at: string | null
  whatsapp_message_id: string | null
  created_at: string
  invoice_id: string
  customer_id: string
}

const STATUS_ORDER = ['draft', 'approved', 'sent', 'failed', 'skipped']

export default async function FollowUpsPage() {
  const supabase = await createClient()

  const { data: business } = await supabase.from('businesses').select('id').maybeSingle()
  if (!business) return <p className="text-gray-500">No business found.</p>

  const { data: followUps } = await supabase
    .from('follow_ups')
    .select(
      `
      id, status, drafted_text, approved_at, sent_at, whatsapp_message_id, created_at, invoice_id, customer_id,
      invoices(invoice_number, amount, amount_paid),
      customers(name, phone)
    `
    )
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(100)

  const sorted = [...(followUps ?? [])].sort(
    (a, b) =>
      STATUS_ORDER.indexOf((a as FollowUp).status) - STATUS_ORDER.indexOf((b as FollowUp).status)
  )

  const counts = {
    draft: sorted.filter((f) => (f as FollowUp).status === 'draft').length,
    approved: sorted.filter((f) => (f as FollowUp).status === 'approved').length,
    sent: sorted.filter((f) => (f as FollowUp).status === 'sent').length,
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Follow-ups</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Review, approve, and send AI-drafted WhatsApp messages to overdue customers.
        </p>
      </div>

      {/* Status summary */}
      <div className="flex gap-3">
        {[
          {
            label: 'Needs review',
            count: counts.draft,
            color: 'bg-yellow-50 border-yellow-200 text-yellow-800',
          },
          {
            label: 'Approved',
            count: counts.approved,
            color: 'bg-blue-50 border-blue-200 text-blue-800',
          },
          {
            label: 'Sent',
            count: counts.sent,
            color: 'bg-green-50 border-green-200 text-green-800',
          },
        ].map((s) => (
          <div
            key={s.label}
            className={`border rounded-lg px-4 py-2 text-sm font-medium ${s.color}`}
          >
            {s.count} {s.label}
          </div>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          <p className="font-medium">No follow-ups yet</p>
          <p className="text-sm mt-1">
            Run the workflow from the Overview page to generate drafts.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((f) => {
            // Supabase returns joined rows as arrays for one-to-one joins
            const raw = f as unknown as Record<string, unknown>
            const fu = raw as unknown as FollowUp
            const inv = (Array.isArray(raw.invoices) ? raw.invoices[0] : raw.invoices) as {
              invoice_number: string
              amount: number
              amount_paid: number
            } | null
            const cust = (Array.isArray(raw.customers) ? raw.customers[0] : raw.customers) as {
              name: string
              phone: string | null
            } | null
            return (
              <FollowUpCard
                key={fu.id}
                id={fu.id}
                status={fu.status}
                draftedText={fu.drafted_text}
                invoiceNumber={inv?.invoice_number ?? '—'}
                outstanding={inv ? inv.amount - inv.amount_paid : 0}
                customerName={cust?.name ?? '—'}
                customerPhone={cust?.phone ?? null}
                sentAt={fu.sent_at}
                approvedAt={fu.approved_at}
                createdAt={fu.created_at}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
