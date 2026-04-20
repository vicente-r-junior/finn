import { describe, it, expect, vi } from 'vitest'

// Helper: chainable mock that supports .select().ilike().maybeSingle() and .insert().select().single()
function makeChain(finalFn: () => Promise<any>) {
  const chain: any = {}
  const methods = ['select', 'ilike', 'single', 'maybeSingle', 'eq', 'insert']
  methods.forEach((m) => {
    chain[m] = (..._args: any[]) => {
      if (m === 'single' || m === 'maybeSingle') return finalFn()
      return chain
    }
  })
  return chain
}

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: (table: string) => {
      if (table === 'categories') {
        return {
          select: () => ({
            ilike: () => ({
              maybeSingle: async () => ({ data: { id: 'cat-1', name: 'Food' }, error: null }),
            }),
          }),
          insert: async () => ({ error: null }),
        }
      }
      // transactions table: insert().select().single() returns the row
      return {
        insert: (data: any) => ({
          select: () => ({
            single: async () => ({ data: { id: 'uuid-1', ...data }, error: null }),
          }),
        }),
      }
    },
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
        from: (table: string) => {
          if (table === 'categories') {
            return {
              select: () => ({
                ilike: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
              insert: async () => ({ error: null }),
            }
          }
          return {
            insert: (data: any) => ({
              select: () => ({
                single: async () => ({ data: { id: 'uuid-2', ...data }, error: null }),
              }),
            }),
          }
        },
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
