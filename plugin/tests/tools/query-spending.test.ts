import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        eq: function(this: any) { return this },
        gte: function(this: any) { return this },
        lte: function(this: any) { return this },
        ilike: function(this: any) { return this },
        then: async (resolve: Function) => resolve({
          data: [
            { amount: 150.00, category: 'Alimentação', cost_center: 'Me', date: '2026-04-10', description: 'restaurante' },
            { amount: 50.00, category: 'Alimentação', cost_center: 'Me', date: '2026-04-15', description: 'almoço' },
          ],
          error: null,
        }),
      }),
    }),
  }),
}))

describe('querySpending', () => {
  it('returns formatted summary', async () => {
    const { querySpending } = await import('../../src/tools/query-spending.js')
    const result = await querySpending({
      phone: '+5511999990000',
      period: 'month',
      category: 'Alimentação',
    })
    expect(result.total).toBe(200)
    expect(result.count).toBe(2)
    expect(result.transactions).toHaveLength(2)
  })
})
