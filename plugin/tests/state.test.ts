import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationStateRow, PendingTransaction } from '../src/types.js'

// Mock Supabase
vi.mock('../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}))

describe('loadState', () => {
  it('returns default idle state for unknown phone', async () => {
    const { loadState } = await import('../src/state.js')
    const state = await loadState('+5511999990000')
    expect(state.state).toBe('idle')
    expect(state.pending_transaction).toBeNull()
    expect(state.history).toEqual([])
  })
})

describe('saveState', () => {
  it('saves state without throwing', async () => {
    const { saveState } = await import('../src/state.js')
    const state: ConversationStateRow = {
      phone: '+5511999990000',
      state: 'awaiting_confirm',
      pending_transaction: null,
      target_transaction_id: null,
      history: [],
      updated_at: new Date().toISOString(),
    }
    await expect(saveState(state)).resolves.not.toThrow()
  })
})

describe('defaultState', () => {
  it('creates idle state for a phone', async () => {
    const { defaultState } = await import('../src/state.js')
    const s = defaultState('+5511999990000')
    expect(s.phone).toBe('+5511999990000')
    expect(s.state).toBe('idle')
    expect(s.history).toEqual([])
  })
})
