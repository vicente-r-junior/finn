import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'uuid-1', amount: 25, category: 'Alimentação', cost_center: 'Me', card: 'Mastercard' },
              error: null,
            }),
          }),
        }),
      }),
      select: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              limit: async () => ({
                data: [{ id: 'uuid-1', amount: 20, description: 'almoço', category: 'Alimentação', cost_center: 'Me', card: 'Mastercard', date: '2026-04-18' }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

describe('findTransaction', () => {
  it('finds last matching transaction by description', async () => {
    const { findTransaction } = await import('../../src/tools/update-transaction.js')
    const result = await findTransaction('+55', 'almoço')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('uuid-1')
  })
})

describe('updateTransaction', () => {
  it('updates specified fields', async () => {
    const { updateTransaction } = await import('../../src/tools/update-transaction.js')
    const result = await updateTransaction('uuid-1', { amount: 25 })
    expect(result.amount).toBe(25)
  })
})
