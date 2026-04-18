import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type {
  Transaction,
  ConversationStateRow,
  VocabularyEntry,
  CreditCard,
  Category,
} from '../types.js'

type WithIndex<T> = T & Record<string, unknown>

export interface Database {
  finn: {
    Tables: {
      transactions: {
        Row: WithIndex<Transaction>
        Insert: WithIndex<Omit<Transaction, 'id' | 'created_at' | 'updated_at'>>
        Update: WithIndex<Partial<Omit<Transaction, 'id' | 'created_at'>>>
        Relationships: []
      }
      conversation_state: {
        Row: WithIndex<ConversationStateRow>
        Insert: WithIndex<ConversationStateRow>
        Update: WithIndex<Partial<ConversationStateRow>>
        Relationships: []
      }
      vocabulary: {
        Row: WithIndex<VocabularyEntry>
        Insert: WithIndex<Omit<VocabularyEntry, 'id'> & { updated_at?: string }>
        Update: WithIndex<Partial<Omit<VocabularyEntry, 'id'>>>
        Relationships: []
      }
      credit_cards: {
        Row: WithIndex<CreditCard>
        Insert: WithIndex<Omit<CreditCard, 'id'>>
        Update: WithIndex<Partial<Omit<CreditCard, 'id'>>>
        Relationships: []
      }
      categories: {
        Row: WithIndex<Category>
        Insert: WithIndex<Omit<Category, 'id'>>
        Update: WithIndex<Partial<Omit<Category, 'id'>>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
  }
}

let _client: SupabaseClient<Database, 'finn'> | null = null

export function db(): SupabaseClient<Database, 'finn'> {
  if (_client) return _client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url) throw new Error('SUPABASE_URL environment variable is required')
  if (!key) throw new Error('SUPABASE_SERVICE_KEY environment variable is required')

  _client = createClient<Database, 'finn'>(url, key, {
    db: { schema: 'finn' },
  })

  return _client
}

// Reset for testing
export function _resetClient(): void {
  _client = null
}
