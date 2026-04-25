import { db } from '../db/supabase.js'
import { inferBillingInfo } from '../cards.js'
import type { PendingTransaction, Transaction } from '../types.js'

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim()
}

async function ensureCategoryExists(name: string): Promise<void> {
  const normalized = toTitleCase(name)
  const { data } = await db()
    .from('categories')
    .select('id')
    .ilike('name', normalized)
    .maybeSingle()

  if (!data) {
    await db().from('categories').insert({ name: normalized })
  }
}

export async function saveTransaction(
  params: PendingTransaction & { phone: string }
): Promise<Transaction> {
  const category = toTitleCase(params.category)
  await ensureCategoryExists(category)

  // Auto-infer billing_cycle and due_date for credit card transactions
  // when they weren't explicitly provided (i.e. manual text/audio entries)
  let due_date = params.due_date
  let billing_cycle = params.billing_cycle
  if (params.card && due_date === undefined && billing_cycle === undefined) {
    const inferred = await inferBillingInfo(params.card, params.date)
    if (inferred) {
      due_date = inferred.due_date
      billing_cycle = inferred.billing_cycle
    }
  }

  const { data, error } = await db()
    .from('transactions')
    .insert({
      phone: params.phone,
      type: params.type,
      amount: params.amount,
      description: params.description,
      category,
      cost_center: params.cost_center,
      card: params.card,
      date: params.date,
      source: params.source,
      raw_input: params.raw_input,
      ...(due_date !== undefined ? { due_date } : {}),
      ...(billing_cycle !== undefined ? { billing_cycle } : {}),
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save transaction: ${error.message}`)
  if (!data) throw new Error('Failed to save transaction: no data returned')
  return data as Transaction
}
