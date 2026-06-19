// DSO (Days Sales Outstanding) and rupees-recovered — pure arithmetic.
// Shared across api and dashboard workspaces. No external dependencies.
// CLAUDE.md Hard Rule #6: this is arithmetic, never LLM.

export function calcDsoDays(
  accountsReceivable: number,
  creditSales30d: number,
  windowDays = 30
): number | null {
  if (creditSales30d === 0) return null
  return Number(((accountsReceivable / creditSales30d) * windowDays).toFixed(1))
}

export function calcRupeesRecovered(
  invoices: Array<{ amount: number | string; amount_paid: number | string }>
): number {
  return invoices
    .filter((inv) => Number(inv.amount_paid) >= Number(inv.amount))
    .reduce((sum, inv) => sum + Number(inv.amount), 0)
}
