import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: (table: string) => ({
      insert: async (data: any) => {
        if (table === 'transactions') return { data: [{ id: 'uuid-1', ...data }], error: null }
        if (table === 'categories') return { error: null }
        return { error: null }
      },
      select: () => ({
        ilike: () => ({ single: async () => ({ data: { id: 'cat-1', name: 'Alimentação' }, error: null }) }),
      }),
    }),
  }),
}))

describe('saveTransaction', () => {
  it('inserts a transaction and returns it', async () => {
    const { saveTransaction } = await import('../../src/tools/save-transaction.js')
    const result = await saveTransaction({
      phone: '+5511999990000',
      type: 'expense',
      amount: 20,
      description: 'almoço',
      category: 'Alimentação',
      cost_center: 'Me',
      card: 'Mastercard',
      date: '2026-04-18',
      source: 'text',
      raw_input: 'gastei 20 no almoço',
    })
    expect(result.id).toBe('uuid-1')
    expect(result.amount).toBe(20)
  })

  it('creates new category if it does not exist', async () => {
    vi.resetModules()
    vi.doMock('../../src/db/supabase.js', () => ({
      db: () => ({
        from: (table: string) => ({
          insert: async (data: any) => ({ data: [{ id: 'uuid-2', ...data }], error: null }),
          select: () => ({
            ilike: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
          }),
        }),
      }),
    }))
    const { saveTransaction } = await import('../../src/tools/save-transaction.js')
    const result = await saveTransaction({
      phone: '+5511999990000',
      type: 'expense',
      amount: 80,
      description: 'pet shop',
      category: 'Pet Shop',
      cost_center: 'Me',
      card: 'Mastercard',
      date: '2026-04-18',
      source: 'text',
      raw_input: 'gastei 80 no pet shop',
    })
    expect(result.category).toBe('Pet Shop')
  })
})
