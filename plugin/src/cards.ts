import type { CardName, Transaction } from './types.js'
import { CASH_KEYWORDS, DEFAULT_CARD } from './types.js'
import { db } from './db/supabase.js'

const CARD_ALIASES: Record<string, CardName> = {
  mastercard: 'Mastercard',
  master: 'Mastercard',
  visa: 'Visa',
  aeternum: 'Aeternum',
}

export function resolveCard(message: string): CardName | null {
  const lower = message.toLowerCase()

  // Check for cash/pix keywords first
  if (CASH_KEYWORDS.some((k) => lower.includes(k))) return null

  // Check explicit card names
  for (const [alias, cardName] of Object.entries(CARD_ALIASES)) {
    if (lower.includes(alias)) return cardName
  }

  // Default
  return DEFAULT_CARD
}

export interface DuplicateMatch {
  incomingIndex: number
  existingId: string
  reason: string
}

export function detectDuplicates(
  incoming: Array<{ amount: number; date: string; card: string | null; description?: string }>,
  existing: Array<{ id: string; amount: number; date: string; card: string | null; description?: string }>
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = []

  incoming.forEach((inc, i) => {
    for (const ext of existing) {
      if (inc.card !== ext.card) continue

      const maxAmount = Math.max(Math.abs(inc.amount), Math.abs(ext.amount))
      const amountDiff = maxAmount === 0 ? 0 : Math.abs(inc.amount - ext.amount) / maxAmount
      if (amountDiff > 0.01) continue

      const incDate = new Date(inc.date).getTime()
      const extDate = new Date(ext.date).getTime()
      const daysDiff = Math.abs(incDate - extDate) / (1000 * 60 * 60 * 24)
      if (daysDiff > 3) continue

      matches.push({
        incomingIndex: i,
        existingId: ext.id,
        reason: `R$${inc.amount} · ${inc.card} · ${inc.date} matches existing entry`,
      })
      break
    }
  })

  return matches
}

/**
 * Given a card name and a transaction date, look up the card's closing_day and due_day
 * from the credit_cards table and return the inferred billing_cycle and due_date.
 *
 * Logic:
 *   txDay <= closing_day  → current month's cycle, due next month
 *   txDay >  closing_day  → next month's cycle,    due month after next
 */
export async function inferBillingInfo(
  cardName: CardName,
  transactionDate: string  // YYYY-MM-DD
): Promise<{ billing_cycle: string; due_date: string } | null> {
  const { data, error } = await db()
    .from('credit_cards')
    .select('closing_day, due_day, next_closing_date')
    .eq('name', cardName)
    .maybeSingle()

  if (error || !data) return null
  const { closing_day, due_day, next_closing_date } = data as {
    closing_day: number | null
    due_day: number | null
    next_closing_date: string | null  // YYYY-MM-DD
  }
  if (!due_day) return null

  const [y, m, d] = transactionDate.split('-').map(Number)
  const txTime = new Date(transactionDate).getTime()

  // If we have the exact next closing date from the last PDF, use it directly.
  // Expense before or on next_closing_date → belongs to that closing's cycle.
  // Expense after next_closing_date → belongs to the cycle after.
  if (next_closing_date) {
    const nextClose = new Date(next_closing_date)
    const nextCloseTime = nextClose.getTime()

    let cycleYear: number, cycleMonth: number
    if (txTime <= nextCloseTime) {
      // This cycle: billing_cycle = month of next_closing_date
      cycleYear = nextClose.getFullYear()
      cycleMonth = nextClose.getMonth() + 1
    } else {
      // Next cycle: billing_cycle = month after next_closing_date
      cycleYear = nextClose.getFullYear()
      cycleMonth = nextClose.getMonth() + 2
      if (cycleMonth > 12) { cycleMonth = 1; cycleYear++ }
    }

    let dueYear = cycleYear
    let dueMonth = cycleMonth + 1
    if (dueMonth > 12) { dueMonth = 1; dueYear++ }

    const billing_cycle = `${cycleYear}-${String(cycleMonth).padStart(2, '0')}`
    const due_date = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(due_day).padStart(2, '0')}`
    return { billing_cycle, due_date }
  }

  // Fallback: use closing_day integer only
  if (!closing_day) return null

  let cycleYear = y
  let cycleMonth = d <= closing_day ? m : m + 1
  if (cycleMonth > 12) { cycleMonth = 1; cycleYear++ }

  let dueYear = cycleYear
  let dueMonth = cycleMonth + 1
  if (dueMonth > 12) { dueMonth = 1; dueYear++ }

  const billing_cycle = `${cycleYear}-${String(cycleMonth).padStart(2, '0')}`
  const due_date = `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(due_day).padStart(2, '0')}`

  return { billing_cycle, due_date }
}

export async function updateCardCycleFromPdf(
  cardName: CardName,
  closingDay: number,
  dueDay: number,
  nextClosingDate?: string  // YYYY-MM-DD — "Previsão prox. Fechamento"
): Promise<void> {
  await db()
    .from('credit_cards')
    .update({
      closing_day: closingDay,
      due_day: dueDay,
      ...(nextClosingDate ? { next_closing_date: nextClosingDate } : {}),
    })
    .eq('name', cardName)
}

export async function getCardsNearDueDate(daysAhead = 3): Promise<Array<{ name: CardName; due_day: number }>> {
  const now = new Date()
  const today = now.getDate()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const { data, error } = await db().from('credit_cards').select('name, due_day')
  if (error || !data) return []

  return (data as Array<{ name: CardName; due_day: number }>).filter((card) => {
    const daysUntilDue = card.due_day >= today ? card.due_day - today : daysInMonth - today + card.due_day
    return daysUntilDue <= daysAhead
  })
}
