import { db } from '../db/supabase.js'
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
    })
    .select()
    .single()

  if (error) throw new Error(`Failed to save transaction: ${error.message}`)
  if (!data) throw new Error('Failed to save transaction: no data returned')
  return data as Transaction
}
