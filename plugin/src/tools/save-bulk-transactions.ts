import { saveTransaction } from './save-transaction.js'
import type { InvoiceItem } from '../types.js'

export interface BulkSaveResult {
  saved: number
  total: number
  breakdown: Record<string, number>
}

export async function saveBulkTransactions(
  phone: string,
  items: InvoiceItem[],
  approvedCategories: Record<number, string> = {},
  fallbackDueDate?: string,
  fallbackBillingCycle?: string,
  fallbackCard?: string,
): Promise<BulkSaveResult> {
  const eligible = items.filter((item) => !item.isPayment)
  let saved = 0
  const breakdown: Record<string, number> = {}

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.isPayment) continue

    const category = approvedCategories[i] ?? item.category ?? 'Others'

    // Use item-level values first, fall back to invoice-level, then null
    const due_date = item.due_date || fallbackDueDate || null
    const billing_cycle = item.billing_cycle || fallbackBillingCycle || null
    // If LLM defaulted card to Mastercard but we have a known invoice card, use it
    const card = (item.card && item.card !== 'Mastercard') ? item.card : (fallbackCard || item.card)

    try {
      await saveTransaction({
        phone,
        type: 'expense',
        amount: item.amount,
        description: item.description,
        category,
        cost_center: item.cost_center,
        card,
        date: item.isoDate,
        source: 'pdf',
        raw_input: `${item.date} ${item.description} ${item.amount}`,
        due_date,
        billing_cycle,
      })

      saved++
      breakdown[category] = (breakdown[category] ?? 0) + item.amount
    } catch (err) {
      console.error(`[save-bulk] failed to save item ${i} (${item.description}):`, err)
    }
  }

  return { saved, total: eligible.length, breakdown }
}
