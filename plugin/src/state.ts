import { db } from './db/supabase.js'
import type { ConversationStateRow, ChatMessage } from './types.js'

export function defaultState(phone: string): ConversationStateRow {
  return {
    phone,
    state: 'idle',
    pending_transaction: null,
    target_transaction_id: null,
    history: [],
    updated_at: new Date().toISOString(),
  }
}

export async function loadState(phone: string): Promise<ConversationStateRow> {
  const { data, error } = await db()
    .from('conversation_state')
    .select('*')
    .eq('phone', phone)
    .single()

  if (error || !data) return defaultState(phone)
  return data as ConversationStateRow
}

export async function saveState(state: ConversationStateRow): Promise<void> {
  const { error } = await db()
    .from('conversation_state')
    .upsert({ ...state, updated_at: new Date().toISOString() }, { onConflict: 'phone' })

  if (error) throw new Error(`Failed to save state: ${error.message}`)
}

export function appendMessage(
  state: ConversationStateRow,
  role: 'user' | 'assistant',
  content: string,
  maxHistory = 20
): ConversationStateRow {
  const history: ChatMessage[] = [
    ...state.history,
    { role, content },
  ].slice(-maxHistory)

  return { ...state, history }
}
