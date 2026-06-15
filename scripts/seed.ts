#!/usr/bin/env node
// Synthetic seed data generator — NO real PII.
// Generates a realistic dataset for one business with overdue invoices.
// Run: npx tsx scripts/seed.ts

import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Fake data pools ───────────────────────────────────────────────────────────

const CUSTOMER_NAMES = [
  'Sharma Trading Co.',
  'Mehta Distributors',
  'Patel Wholesale',
  'Gupta Enterprises',
  'Singh & Sons',
  'Kumar Suppliers',
  'Agarwal Traders',
  'Joshi Brothers',
  'Verma Electronics',
  'Rao Provisions',
]

const INVOICE_NOTES = [
  'Q1 supply order',
  'Monthly stock replenishment',
  'Bulk order - festival season',
  'Advance order',
  'Credit sale',
  null,
  null,
  null,
]

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]
}

function isoDate(daysFromNow: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

// ── Generate ──────────────────────────────────────────────────────────────────

const BUSINESS_ID = uuid()
const OWNER_USER_ID = uuid() // placeholder — replaced during real onboarding

const customers = CUSTOMER_NAMES.map((name, i) => ({
  id: uuid(),
  business_id: BUSINESS_ID,
  external_id: `ZOHO-CUST-${String(i + 1).padStart(3, '0')}`,
  name,
  phone: `+919${randomInt(100000000, 999999999)}`,
  email: `accounts@${name.toLowerCase().replace(/[^a-z]/g, '')}.com`,
  credit_limit: pick([50000, 100000, 150000, 200000, 500000]),
  notes: null,
}))

// Mix of overdue, current, and paid invoices
const invoices: Array<Record<string, unknown>> = []
const payments: Array<Record<string, unknown>> = []

let invoiceSeq = 1

customers.forEach((customer) => {
  // 2–4 invoices per customer
  const count = randomInt(2, 4)
  for (let j = 0; j < count; j++) {
    const invId = uuid()
    const amount = randomInt(5, 200) * 1000
    const dueDaysAgo = pick([-30, -15, 0, 15, 45, 75, 100]) // mix of future/past

    let amountPaid = 0
    let status: string = 'open'

    if (dueDaysAgo < -10) {
      // Future: unpaid open
      status = 'open'
    } else if (dueDaysAgo >= 0 && Math.random() > 0.4) {
      // Some past-due invoices are partially paid
      amountPaid = Math.round(amount * pick([0, 0.25, 0.5]))
      status = amountPaid === 0 ? 'open' : 'partial'
    } else if (Math.random() > 0.6) {
      // Some are fully paid
      amountPaid = amount
      status = 'paid'
    }

    invoices.push({
      id: invId,
      business_id: BUSINESS_ID,
      customer_id: customer.id,
      external_id: `ZOHO-INV-${String(invoiceSeq).padStart(4, '0')}`,
      invoice_number: `INV-2026-${String(invoiceSeq).padStart(4, '0')}`,
      amount,
      amount_paid: amountPaid,
      currency: 'INR',
      issue_date: isoDate(dueDaysAgo - 30),
      due_date: isoDate(-dueDaysAgo),
      status,
      notes: pick(INVOICE_NOTES),
    })

    if (amountPaid > 0) {
      payments.push({
        id: uuid(),
        business_id: BUSINESS_ID,
        invoice_id: invId,
        external_id: null,
        amount: amountPaid,
        paid_at: new Date(Date.now() - randomInt(1, 10) * 86400000).toISOString(),
        payment_method: pick(['bank_transfer', 'upi', 'cheque', 'cash']),
        reference: `UTR${randomInt(100000000000, 999999999999)}`,
        notes: null,
      })
    }

    invoiceSeq++
  }
})

// ── Emit SQL ──────────────────────────────────────────────────────────────────

function sq(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

const lines: string[] = [
  `-- CoreOps seed data — synthetic, NO real PII`,
  `-- Generated: ${new Date().toISOString()}`,
  `-- For local Supabase dev only. Do NOT apply to production.`,
  ``,
  `-- Create a seed auth user so the businesses FK is satisfied.`,
  `-- Password: SeedDev123! (local dev only — never use in production)`,
  `insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, aud, role, created_at, updated_at)`,
  `values (`,
  `  ${sq(OWNER_USER_ID)},`,
  `  '00000000-0000-0000-0000-000000000000',`,
  `  'seed-owner@coreops.local',`,
  `  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh9i',`,
  `  now(), 'authenticated', 'authenticated', now(), now()`,
  `) on conflict (id) do nothing;`,
  ``,
  `insert into businesses (id, owner_user_id, name, owner_phone, gstin, timezone)`,
  `values (${sq(BUSINESS_ID)}, ${sq(OWNER_USER_ID)}, 'Sharma Trading Co. (Seed)', '+919876543210', '27AABCS1429B1Z1', 'Asia/Kolkata')`,
  `on conflict (owner_user_id) do nothing;`,
  ``,
  `-- Customers`,
]

customers.forEach((c) => {
  lines.push(
    `insert into customers (id, business_id, external_id, name, phone, email, credit_limit) values ` +
      `(${sq(c.id)}, ${sq(c.business_id)}, ${sq(c.external_id)}, ${sq(c.name)}, ${sq(c.phone)}, ${sq(c.email)}, ${sq(c.credit_limit)});`
  )
})

lines.push(``, `-- Invoices`)
invoices.forEach((inv) => {
  lines.push(
    `insert into invoices (id, business_id, customer_id, external_id, invoice_number, amount, amount_paid, currency, issue_date, due_date, status, notes) values ` +
      `(${sq(inv.id)}, ${sq(inv.business_id)}, ${sq(inv.customer_id)}, ${sq(inv.external_id)}, ${sq(inv.invoice_number)}, ${sq(inv.amount)}, ${sq(inv.amount_paid)}, ${sq(inv.currency)}, ${sq(inv.issue_date)}, ${sq(inv.due_date)}, ${sq(inv.status)}, ${sq(inv.notes)});`
  )
})

lines.push(``, `-- Payments`)
payments.forEach((p) => {
  lines.push(
    `insert into payments (id, business_id, invoice_id, amount, paid_at, payment_method, reference) values ` +
      `(${sq(p.id)}, ${sq(p.business_id)}, ${sq(p.invoice_id)}, ${sq(p.amount)}, ${sq(p.paid_at)}, ${sq(p.payment_method)}, ${sq(p.reference)});`
  )
})

const sql = lines.join('\n') + '\n'
const outPath = resolve(__dirname, '../supabase/seed.sql')
writeFileSync(outPath, sql, 'utf8')

console.log(`✓ Seed SQL written to supabase/seed.sql`)
console.log(`  Business:  ${BUSINESS_ID}`)
console.log(`  Customers: ${customers.length}`)
console.log(`  Invoices:  ${invoices.length}`)
console.log(`  Payments:  ${payments.length}`)
console.log(
  `  Overdue:   ${invoices.filter((i) => i.status !== 'paid' && (i.due_date as string) <= new Date().toISOString().split('T')[0]).length}`
)
