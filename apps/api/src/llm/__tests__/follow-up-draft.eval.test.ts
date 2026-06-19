/**
 * Eval suite for follow-up draft generation — runs against the REAL LLM API
 * resolved from LLM_RANKING_FOLLOW_UP_DRAFT (see model-ranking.ts), so it
 * proves something a mocked test can't: that whichever model is actually
 * configured produces drafts that pass guardrails and stay on-topic. Skipped
 * when no candidate's API key is present, same gating pattern as the
 * Supabase-only integration tests — this is NOT mocked out as a substitute
 * for a real run; if this never executes, it has not been verified, and the
 * report says so explicitly.
 *
 * Grounding requirement: every generated draft must contain the exact rupee
 * amount from the input. The system prompt instructs the model to include it,
 * so any case where the amount is absent or hallucinated is a real failure.
 *
 * CI: runs via the `eval` job in ci.yml when OPENAI_API_KEY is set as a
 * GitHub Actions secret. Uses gpt-5-nano (cheapest model) for cost control:
 * ~20 cases × $0.0001 = $0.002 per CI run.
 */
import { describe, it, expect, vi } from 'vitest'
import { getLlmClient } from '../registry.js'
import { parseModelRanking, resolveModelCandidate } from '../model-ranking.js'
import { draftFollowUp } from '../follow-up-draft.js'
import { checkFollowUpDraft } from '../guardrails.js'
import { toFollowUpDraftInput } from '../redact.js'
import type { ReceivablesStateItem } from '../../services/receivables-state.js'
import type { SupabaseClient } from '@supabase/supabase-js'

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const hasAnyKey = Boolean(ANTHROPIC_API_KEY || OPENAI_API_KEY)

const DEFAULT_RANKING =
  'openai:gpt-5-nano,openai:gpt-5-mini,anthropic:claude-haiku-4-5-20251001,anthropic:claude-sonnet-4-6'
const ranking = parseModelRanking(process.env.LLM_RANKING_FOLLOW_UP_DRAFT ?? DEFAULT_RANKING)

// Asserts the amount_outstanding from the input appears in the generated text.
// Strips commas and ₹ before comparing so that ₹50,000 / 1,25,000 / 50000
// all normalise to their bare digit string (e.g. "50000", "125000").
function assertAmountGrounding(text: string, item: ReceivablesStateItem): void {
  const normalised = text.replace(/[₹,\s]/g, '')
  const expected = String(item.amount_outstanding)
  if (!normalised.includes(expected)) {
    throw new Error(
      `Grounding failure — amount ₹${item.amount_outstanding} not found in draft.\n` +
        `  Customer: ${item.customer_name}, Invoice: ${item.invoice_number}\n` +
        `  Draft: "${text}"`
    )
  }
}

// 20-case golden set covering:
// - All four age buckets and their exact boundaries
// - Fully outstanding and partially paid invoices
// - Very small (₹2,500) and very large (₹500,000) amounts
// - Round numbers, odd amounts, Indian lakh-scale figures
// - Customer name formats: dots (R.K.), ampersand (&), Pvt Ltd suffix,
//   short names, long names, location qualifier
const goldenSet: ReceivablesStateItem[] = [
  // ── Original 3 cases ──────────────────────────────────────────────────────
  {
    invoice_id: 'inv-1',
    invoice_number: 'INV-1001',
    customer_id: 'c1',
    customer_name: 'Sharma Traders',
    customer_phone: '+919876543210',
    amount: 50000,
    amount_outstanding: 50000,
    days_overdue: 5,
    age_bucket: '1-30',
  },
  {
    invoice_id: 'inv-2',
    invoice_number: 'INV-2042',
    customer_id: 'c2',
    customer_name: 'Patel Hardware & Co',
    customer_phone: '+919812345678',
    amount: 125000,
    amount_outstanding: 75000,
    days_overdue: 47,
    age_bucket: '31-60',
  },
  {
    invoice_id: 'inv-3',
    invoice_number: 'INV-3199',
    customer_id: 'c3',
    customer_name: 'Singh Enterprises',
    customer_phone: '+919900112233',
    amount: 8000,
    amount_outstanding: 8000,
    days_overdue: 95,
    age_bucket: '90+',
  },

  // ── Bucket boundaries ─────────────────────────────────────────────────────
  // 1-day (minimum possible overdue)
  {
    invoice_id: 'inv-4',
    invoice_number: 'INV-4001',
    customer_id: 'c4',
    customer_name: 'Mehta Distributors',
    customer_phone: '+919111222333',
    amount: 20000,
    amount_outstanding: 20000,
    days_overdue: 1,
    age_bucket: '1-30',
  },
  // 30-day (top of 1-30 bucket)
  {
    invoice_id: 'inv-5',
    invoice_number: 'INV-5010',
    customer_id: 'c5',
    customer_name: 'Gupta Textiles',
    customer_phone: '+919222333444',
    amount: 35000,
    amount_outstanding: 35000,
    days_overdue: 30,
    age_bucket: '1-30',
  },
  // 31-day (enters 31-60 bucket)
  {
    invoice_id: 'inv-6',
    invoice_number: 'INV-6020',
    customer_id: 'c6',
    customer_name: 'Verma & Sons Wholesale',
    customer_phone: '+919333444555',
    amount: 18500,
    amount_outstanding: 18500,
    days_overdue: 31,
    age_bucket: '31-60',
  },
  // 60-day (top of 31-60 bucket)
  {
    invoice_id: 'inv-7',
    invoice_number: 'INV-7030',
    customer_id: 'c7',
    customer_name: 'Jain Brothers Trading',
    customer_phone: '+919444555666',
    amount: 92000,
    amount_outstanding: 92000,
    days_overdue: 60,
    age_bucket: '31-60',
  },
  // 61-day (enters 61-90 bucket)
  {
    invoice_id: 'inv-8',
    invoice_number: 'INV-8040',
    customer_id: 'c8',
    customer_name: 'Agarwal Wholesale',
    customer_phone: '+919555666777',
    amount: 15750,
    amount_outstanding: 15750,
    days_overdue: 61,
    age_bucket: '61-90',
  },
  // 90-day (top of 61-90 bucket)
  {
    invoice_id: 'inv-9',
    invoice_number: 'INV-9050',
    customer_id: 'c9',
    customer_name: 'Desai Trading Co',
    customer_phone: '+919666777888',
    amount: 44000,
    amount_outstanding: 44000,
    days_overdue: 90,
    age_bucket: '61-90',
  },
  // 121-day (deep into 90+)
  {
    invoice_id: 'inv-10',
    invoice_number: 'INV-1060',
    customer_id: 'c10',
    customer_name: 'Rao Suppliers',
    customer_phone: '+919777888999',
    amount: 6000,
    amount_outstanding: 6000,
    days_overdue: 121,
    age_bucket: '90+',
  },
  // 155-day (extremely old — tone must remain polite, not threatening)
  {
    invoice_id: 'inv-11',
    invoice_number: 'INV-1070',
    customer_id: 'c11',
    customer_name: 'Bose & Company',
    customer_phone: '+919888000111',
    amount: 28000,
    amount_outstanding: 28000,
    days_overdue: 155,
    age_bucket: '90+',
  },

  // ── Amount edge cases ─────────────────────────────────────────────────────
  // Very small (₹2,500)
  {
    invoice_id: 'inv-12',
    invoice_number: 'INV-1080',
    customer_id: 'c12',
    customer_name: 'Lakshmi Stores',
    customer_phone: '+919111000222',
    amount: 2500,
    amount_outstanding: 2500,
    days_overdue: 10,
    age_bucket: '1-30',
  },
  // Very large (₹500,000 = 5 lakh)
  {
    invoice_id: 'inv-13',
    invoice_number: 'INV-1090',
    customer_id: 'c13',
    customer_name: 'Gujarat Wholesale Pvt Ltd',
    customer_phone: '+919222000333',
    amount: 500000,
    amount_outstanding: 500000,
    days_overdue: 22,
    age_bucket: '1-30',
  },
  // Round number (₹10,000)
  {
    invoice_id: 'inv-14',
    invoice_number: 'INV-1100',
    customer_id: 'c14',
    customer_name: 'Metro Cash & Carry',
    customer_phone: '+919333000444',
    amount: 10000,
    amount_outstanding: 10000,
    days_overdue: 25,
    age_bucket: '1-30',
  },
  // Odd amount (₹12,347)
  {
    invoice_id: 'inv-15',
    invoice_number: 'INV-1110',
    customer_id: 'c15',
    customer_name: 'Sri Ram General Stores',
    customer_phone: '+919444000555',
    amount: 12347,
    amount_outstanding: 12347,
    days_overdue: 37,
    age_bucket: '31-60',
  },
  // Partial payment — only ₹5,000 of ₹20,000 outstanding
  {
    invoice_id: 'inv-16',
    invoice_number: 'INV-1120',
    customer_id: 'c16',
    customer_name: 'Kumar Fertilizers',
    customer_phone: '+919555000666',
    amount: 20000,
    amount_outstanding: 5000,
    days_overdue: 15,
    age_bucket: '1-30',
  },

  // ── Customer name format edge cases ──────────────────────────────────────
  // Name with dots (R.K.)
  {
    invoice_id: 'inv-17',
    invoice_number: 'INV-1130',
    customer_id: 'c17',
    customer_name: 'R.K. Brothers',
    customer_phone: '+919666000777',
    amount: 11000,
    amount_outstanding: 11000,
    days_overdue: 8,
    age_bucket: '1-30',
  },
  // Name with ampersand and Pvt Ltd suffix
  {
    invoice_id: 'inv-18',
    invoice_number: 'INV-1140',
    customer_id: 'c18',
    customer_name: 'Shah & Sons Trading',
    customer_phone: '+919777000888',
    amount: 33000,
    amount_outstanding: 33000,
    days_overdue: 18,
    age_bucket: '1-30',
  },
  // Long descriptive name
  {
    invoice_id: 'inv-19',
    invoice_number: 'INV-1150',
    customer_id: 'c19',
    customer_name: 'Rajasthan Grains & Commodities Pvt Ltd',
    customer_phone: '+919888000999',
    amount: 85000,
    amount_outstanding: 85000,
    days_overdue: 70,
    age_bucket: '61-90',
  },
  // Partial payment, large original amount — checks model uses outstanding not total
  {
    invoice_id: 'inv-20',
    invoice_number: 'INV-1160',
    customer_id: 'c20',
    customer_name: 'Himalaya Food Products',
    customer_phone: '+919999000111',
    amount: 100000,
    amount_outstanding: 67500,
    days_overdue: 42,
    age_bucket: '31-60',
  },
]

describe.skipIf(!hasAnyKey)('Follow-up draft eval (real LLM API)', () => {
  // describe.skipIf still executes this body to register tests even when
  // skipped — resolveModelCandidate() throws without a key, so bail out
  // before calling it rather than relying on the skip alone.
  if (!hasAnyKey) return

  const candidate = resolveModelCandidate(ranking, {
    anthropic: ANTHROPIC_API_KEY,
    openai: OPENAI_API_KEY,
  })
  const apiKey = candidate.provider === 'anthropic' ? ANTHROPIC_API_KEY! : OPENAI_API_KEY!
  const client = getLlmClient(candidate.provider, apiKey, candidate.model)

  it(`resolved to ${candidate.provider}:${candidate.model} from the configured keys`, () => {
    expect(client.provider).toBe(candidate.provider)
    expect(client.model).toBe(candidate.model)
  })

  for (const item of goldenSet) {
    it(`[${item.age_bucket}] ${item.customer_name} — ${item.days_overdue}d overdue, ₹${item.amount_outstanding} outstanding`, async () => {
      const input = toFollowUpDraftInput(item)
      const result = await client.generateFollowUpDraft(input)

      // Guardrails: length, no URLs, customer name, invoice number
      expect(() => checkFollowUpDraft(result.message_text, input)).not.toThrow()

      // Grounding: amount must appear in the output (no hallucinated figures)
      assertAmountGrounding(result.message_text, item)

      expect(result.input_tokens).toBeGreaterThan(0)
      expect(result.output_tokens).toBeGreaterThan(0)
    }, 30000)
  }

  it('draftFollowUp() end-to-end: real LLM call + cost logged via the supplied client', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const supabase = { from: vi.fn().mockReturnValue({ insert }) } as unknown as SupabaseClient

    const text = await draftFollowUp(client, supabase, 'biz-eval', goldenSet[0]!)

    expect(text).toContain('Sharma Traders')
    expect(text).toContain('INV-1001')
    assertAmountGrounding(text, goldenSet[0]!)
    expect(supabase.from).toHaveBeenCalledWith('llm_usage_log')
    expect(insert).toHaveBeenCalledTimes(1)
  }, 30000)
})

describe.skipIf(hasAnyKey)('Follow-up draft eval (skipped notice)', () => {
  it('was skipped — no ANTHROPIC_API_KEY or OPENAI_API_KEY set', () => {
    expect(hasAnyKey).toBe(false)
  })
})
