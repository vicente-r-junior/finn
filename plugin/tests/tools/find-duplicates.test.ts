import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InvoiceItem } from '../../src/types.js'

function makeItem(overrides: Partial<InvoiceItem> = {}): InvoiceItem {
  return {
    date: '06/04',
    isoDate: '2026-04-06',
    description: 'PETLOVESAUD',
    installment: null,
    amount: 80.00,
    isPayment: false,
    isCharge: false,
    category: 'Pet',
    cost_center: 'Me',
    card: 'Visa',
    cardHolder: 'JOHN DOE',
    due_date: '2026-05-15',
    billing_cycle: '2026-04',
    ...overrides,
  }
}

describe('findDuplicates', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a duplicate when matching transaction exists', async () => {
    vi.doMock('../../src/db/supabase.js', () => ({
      db: () => ({
        from: () => ({
          select: function(this: any) { return this },
          eq: function(this: any) { return this },
          gte: function(this: any) { return this },
          lte: function(this: any) { return this },
          then: async (resolve: Function) => resolve({
            data: [{ id: 'existing-uuid', amount: 80.00, date: '2026-04-06', card: 'Visa' }],
            error: null,
          }),
        }),
      }),
    }))

    const { findDuplicates } = await import('../../src/tools/find-duplicates.js')
    const items = [makeItem()]
    const result = await findDuplicates('+5511999990000', items)
    expect(result).toHaveLength(1)
    expect(result[0].existingId).toBe('existing-uuid')
    expect(result[0].item.description).toBe('PETLOVESAUD')
  })

  it('returns no duplicates when no match exists', async () => {
    vi.doMock('../../src/db/supabase.js', () => ({
      db: () => ({
        from: () => ({
          select: function(this: any) { return this },
          eq: function(this: any) { return this },
          gte: function(this: any) { return this },
          lte: function(this: any) { return this },
          then: async (resolve: Function) => resolve({
            data: [],
            error: null,
          }),
        }),
      }),
    }))

    const { findDuplicates } = await import('../../src/tools/find-duplicates.js')
    const items = [makeItem()]
    const result = await findDuplicates('+5511999990000', items)
    expect(result).toHaveLength(0)
  })

  it('skips payment and charge items', async () => {
    vi.doMock('../../src/db/supabase.js', () => ({
      db: () => ({
        from: () => ({
          select: function(this: any) { return this },
          eq: function(this: any) { return this },
          gte: function(this: any) { return this },
          lte: function(this: any) { return this },
          then: async (resolve: Function) => resolve({
            data: [{ id: 'some-id', amount: 1340.84, date: '2026-04-02', card: 'Visa' }],
            error: null,
          }),
        }),
      }),
    }))

    const { findDuplicates } = await import('../../src/tools/find-duplicates.js')
    const items = [
      makeItem({ isPayment: true, amount: 1340.84 }),
      makeItem({ isCharge: true, amount: 72.94 }),
    ]
    const result = await findDuplicates('+5511999990000', items)
    expect(result).toHaveLength(0)
  })

  it('handles supabase errors gracefully', async () => {
    vi.doMock('../../src/db/supabase.js', () => ({
      db: () => ({
        from: () => ({
          select: function(this: any) { return this },
          eq: function(this: any) { return this },
          gte: function(this: any) { return this },
          lte: function(this: any) { return this },
          then: async (resolve: Function) => resolve({
            data: null,
            error: { message: 'Connection refused' },
          }),
        }),
      }),
    }))

    const { findDuplicates } = await import('../../src/tools/find-duplicates.js')
    const items = [makeItem()]
    const result = await findDuplicates('+5511999990000', items)
    expect(result).toHaveLength(0)
  })
})
