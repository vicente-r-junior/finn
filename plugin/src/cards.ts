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

export async function updateCardCycleFromPdf(
  cardName: CardName,
  closingDay: number,
  dueDay: number
): Promise<void> {
  await db()
    .from('credit_cards')
    .update({ closing_day: closingDay, due_day: dueDay })
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
