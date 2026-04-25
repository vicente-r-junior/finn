import { db } from '../db/supabase.js'
import type { Transaction, CostCenter, CardName } from '../types.js'

export interface QueryParams {
  phone: string
  period?: 'week' | 'month' | 'year' | 'all'
  category?: string
  cost_center?: string
  card?: string
  type?: 'expense' | 'income' | 'card_payment'
  view?: 'competencia' | 'caixa'
}

export interface QueryResult {
  total: number
  count: number
  transactions: Transaction[]
  by_category?: Record<string, number>
}

function getPeriodDates(period: QueryParams['period']): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().split('T')[0]

  if (period === 'week') {
    const from = new Date(now)
    from.setDate(from.getDate() - 7)
    return { from: from.toISOString().split('T')[0], to }
  }
  if (period === 'month') {
    // Use a 60-day rolling window instead of calendar-month start.
    // Credit card purchases are typically made 30–45 days before the invoice
    // due date, so "this month's spending" includes last month's purchases.
    // Example: Transport bought on 2026-03-08 (Aeternum), due 2026-04-10 →
    // should appear when asking "how much on Transport this month?" in April.
    const from = new Date(now)
    from.setDate(from.getDate() - 60)
    return { from: from.toISOString().split('T')[0], to }
  }
  if (period === 'year') {
    const from = new Date(now.getFullYear(), 0, 1)
    return { from: from.toISOString().split('T')[0], to }
  }
  return { from: '2000-01-01', to }
}

export async function querySpending(params: QueryParams): Promise<QueryResult> {
  const { from, to } = getPeriodDates(params.period ?? 'month')

  // 'caixa' view filters by due_date (when money leaves the bank)
  // 'competencia' view (default) filters by date (when purchase was made)
  const dateField = params.view === 'caixa' ? 'due_date' : 'date'

  let query = db()
    .from('transactions')
    .select('*')
    .eq('phone', params.phone)
    .gte(dateField, from)
    .lte(dateField, to)

  if (params.category) query = query.ilike('category', params.category)
  if (params.cost_center) query = query.eq('cost_center', params.cost_center as CostCenter)
  if (params.card) query = query.eq('card', params.card as CardName)
  if (params.type) query = query.eq('type', params.type)

  const { data, error } = await query
  if (error) throw new Error(`Query failed: ${error.message}`)

  const transactions = (data ?? []) as Transaction[]
  const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0)

  const by_category = transactions.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] ?? 0) + Number(t.amount)
    return acc
  }, {})

  return { total: Math.round(total * 100) / 100, count: transactions.length, transactions, by_category }
}
