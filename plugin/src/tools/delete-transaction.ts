import { db } from '../db/supabase.js'

export async function deleteTransaction(phone: string, id: string): Promise<void> {
  const { error } = await db()
    .from('transactions')
    .delete()
    .eq('id', id)
    .eq('phone', phone)   // ownership guard — prevent cross-user deletions

  if (error) throw new Error(`Failed to delete transaction: ${error.message}`)
}
