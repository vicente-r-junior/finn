import { db } from '../db/supabase.js'
import type { Transaction } from '../types.js'

export async function findTransaction(
  phone: string,
  hint: string
): Promise<Transaction | null> {
  const { data, error } = await db()
    .from('transactions')
    .select('*')
    .eq('phone', phone)
    .ilike('description', `%${hint}%`)
    .order('date', { ascending: false })
    .limit(1)

  if (error || !data?.length) return null
  return data[0] as Transaction
}

export async function updateTransaction(
  phone: string,
  id: string,
  fields: Partial<Pick<Transaction, 'amount' | 'category' | 'cost_center' | 'card' | 'date' | 'description'>>
): Promise<Transaction> {
  const { data, error } = await db()
    .from('transactions')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('phone', phone)   // ownership guard — prevent cross-user mutations
    .select()
    .single()

  if (error || !data) throw new Error(`Failed to update transaction: ${error?.message}`)
  return data as Transaction
}
