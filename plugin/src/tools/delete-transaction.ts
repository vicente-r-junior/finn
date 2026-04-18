import { db } from '../db/supabase.js'

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await db()
    .from('transactions')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete transaction: ${error.message}`)
}
