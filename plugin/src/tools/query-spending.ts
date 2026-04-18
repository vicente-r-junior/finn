import { db } from '../db/supabase.js'
import type { Transaction, CostCenter, CardName } from '../types.js'

export interface QueryParams {
  phone: string
  period?: 'week' | 'month' | 'year' | 'all'
  category?: string
  cost_center?: string
  card?: string
  type?: 'expense' | 'income' | 'card_payment'
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
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
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

  let query = db()
    .from('transactions')
    .select('*')
    .eq('phone', params.phone)
    .gte('date', from)
    .lte('date', to)

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
