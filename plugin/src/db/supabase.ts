import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type {
  Transaction,
  ConversationStateRow,
  VocabularyEntry,
  CreditCard,
  Category,
} from '../types.js'

export interface Database {
  finn: {
    Tables: {
      transactions: { Row: Transaction }
      conversation_state: { Row: ConversationStateRow }
      vocabulary: { Row: VocabularyEntry }
      credit_cards: { Row: CreditCard }
      categories: { Row: Category }
    }
  }
}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY

if (!url) throw new Error('SUPABASE_URL environment variable is required')
if (!key) throw new Error('SUPABASE_SERVICE_KEY environment variable is required')

let _client: SupabaseClient<Database> | null = null

export function db(): SupabaseClient<Database> {
  if (_client) return _client

  _client = createClient<Database>(url, key, {
    db: { schema: 'finn' },
  })

  return _client
}

// Reset for testing
export function _resetClient(): void {
  _client = null
}
