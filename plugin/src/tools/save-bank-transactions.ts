import { saveTransaction } from './save-transaction.js'
import type { BankTransaction } from '../types.js'

export interface BankSaveResult {
  saved: number
  total: number
  income: number
  expenses: number
  cardPayments: number
  breakdown: Record<string, number>
}

export async function saveBankTransactions(
  phone: string,
  transactions: BankTransaction[],
): Promise<BankSaveResult> {
  let saved = 0
  let income = 0
  let expenses = 0
  let cardPayments = 0
  const breakdown: Record<string, number> = {}

  for (const tx of transactions) {
    try {
      await saveTransaction({
        phone,
        type: tx.type,
        amount: tx.amount,
        description: tx.description,
        category: tx.category,
        cost_center: 'Me',
        card: tx.card,
        date: tx.date,
        source: 'pdf',
        raw_input: `${tx.date} ${tx.description} ${tx.amount}`,
        due_date: tx.due_date,
        billing_cycle: tx.billing_cycle,
      })

      saved++
      breakdown[tx.category] = (breakdown[tx.category] ?? 0) + tx.amount

      if (tx.type === 'income') income += tx.amount
      else if (tx.type === 'card_payment') cardPayments += tx.amount
      else expenses += tx.amount
    } catch (err) {
      console.error(`[save-bank] failed to save "${tx.description}":`, err)
    }
  }

  return {
    saved,
    total: transactions.length,
    income: Math.round(income * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    cardPayments: Math.round(cardPayments * 100) / 100,
    breakdown,
  }
}
