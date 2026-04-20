import { db } from '../db/supabase.js'
import type { InvoiceItem, Transaction } from '../types.js'

function cardFuzzyMatch(card: string): string {
  const upper = card.toUpperCase()
  if (upper.includes('VISA')) return 'Visa'
  if (upper.includes('MASTER')) return 'Mastercard'
  if (upper.includes('AETERNUM')) return 'Aeternum'
  return card
}

function dateRange(isoDate: string, days: number): { from: string; to: string } {
  const d = new Date(isoDate)
  const from = new Date(d)
  from.setDate(from.getDate() - days)
  const to = new Date(d)
  to.setDate(to.getDate() + days)
  return {
    from: from.toISOString().split('T')[0],
    to: to.toISOString().split('T')[0],
  }
}

export interface DuplicateMatch {
  item: InvoiceItem
  existingId: string
}

export async function findDuplicates(
  phone: string,
  items: InvoiceItem[]
): Promise<DuplicateMatch[]> {
  const matches: DuplicateMatch[] = []

  const eligible = items.filter((item) => !item.isPayment && !item.isCharge)

  for (const item of eligible) {
    const { from, to } = dateRange(item.isoDate, 3)
    const normalizedCard = cardFuzzyMatch(item.card)
    const minAmount = item.amount - 0.01
    const maxAmount = item.amount + 0.01

    const { data, error } = await db()
      .from('transactions')
      .select('id, amount, date, card')
      .eq('phone', phone)
      .eq('card', normalizedCard)
      .gte('amount', minAmount)
      .lte('amount', maxAmount)
      .gte('date', from)
      .lte('date', to)

    if (error) {
      console.error('[find-duplicates] query error:', error.message)
      continue
    }

    const rows = (data ?? []) as Pick<Transaction, 'id' | 'amount' | 'date' | 'card'>[]
    if (rows.length > 0) {
      matches.push({ item, existingId: rows[0].id })
    }
  }

  return matches
}
