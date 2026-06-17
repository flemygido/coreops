import { createClient } from '@/lib/supabase/server'
import RunWorkflowButton from '@/components/RunWorkflowButton'

export const dynamic = 'force-dynamic'

function formatRupees(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function daysSince(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

export default async function DashboardPage() {
  const supabase = await createClient()

  // Load business
  const { data: business } = await supabase.from('businesses').select('id, name').maybeSingle()

  if (!business) {
    return (
      <div className="text-center py-20 text-gray-500">
        <p className="text-lg font-medium">No business found</p>
        <p className="text-sm mt-2">Contact support to set up your account.</p>
      </div>
    )
  }

  // LLM cost this calendar month
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const { data: usageRows } = await supabase
    .from('llm_usage_log')
    .select('cost_usd')
    .eq('business_id', business.id)
    .gte('created_at', monthStart.toISOString())

  const llmCostThisMonth = (usageRows ?? []).reduce((sum, r) => sum + Number(r.cost_usd), 0)

  // Load open/partial invoices with their customers.
  // Explicitly filtering to open/partial ensures paid/void/written_off invoices
  // are never shown as overdue even if amount_paid hasn't synced yet.
  const { data: invoices } = await supabase
    .from('invoices')
    .select(
      'id, invoice_number, amount, amount_paid, due_date, status, customer_id, customers(name)'
    )
    .eq('business_id', business.id)
    .in('status', ['open', 'partial'])
    .order('due_date', { ascending: true })

  const today = new Date()

  const overdueInvoices = (invoices ?? []).filter((inv) => {
    const due = new Date(inv.due_date)
    const outstanding = inv.amount - inv.amount_paid
    return due < today && outstanding > 0
  })

  const totalOverdue = overdueInvoices.reduce((sum, inv) => sum + (inv.amount - inv.amount_paid), 0)

  const byBucket = {
    '1–30 days': overdueInvoices.filter((i) => daysSince(i.due_date) <= 30).length,
    '31–60 days': overdueInvoices.filter(
      (i) => daysSince(i.due_date) > 30 && daysSince(i.due_date) <= 60
    ).length,
    '61–90 days': overdueInvoices.filter(
      (i) => daysSince(i.due_date) > 60 && daysSince(i.due_date) <= 90
    ).length,
    '90+ days': overdueInvoices.filter((i) => daysSince(i.due_date) > 90).length,
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{business.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">Receivables overview</p>
        </div>
        <RunWorkflowButton />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total overdue</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatRupees(totalOverdue)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Invoices overdue
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{overdueInvoices.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            AI cost (month)
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-1">${llmCostThisMonth.toFixed(4)}</p>
        </div>
        {Object.entries(byBucket).map(([label, count]) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{count}</p>
          </div>
        ))}
      </div>

      {/* Overdue invoices table */}
      {overdueInvoices.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">Overdue invoices</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Customer
                </th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Invoice
                </th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Outstanding
                </th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Days overdue
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {overdueInvoices.map((inv) => {
                const days = daysSince(inv.due_date)
                const outstanding = inv.amount - inv.amount_paid
                const customerData = inv.customers
                const customer = Array.isArray(customerData)
                  ? customerData[0]
                  : (customerData as { name: string } | null)
                return (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3.5 font-medium text-gray-900">
                      {(customer as { name: string } | null | undefined)?.name ?? '—'}
                    </td>
                    <td className="px-6 py-3.5 text-gray-500 font-mono text-xs">
                      {inv.invoice_number}
                    </td>
                    <td className="px-6 py-3.5 text-right font-medium">
                      {formatRupees(outstanding)}
                    </td>
                    <td className="px-6 py-3.5 text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          days > 90
                            ? 'bg-red-100 text-red-700'
                            : days > 60
                              ? 'bg-orange-100 text-orange-700'
                              : days > 30
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {days}d
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
          <p className="font-medium">No overdue invoices</p>
          <p className="text-sm mt-1">All invoices are within their due date.</p>
        </div>
      )}
    </div>
  )
}
