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

function makeDbMock() {
  return {
    db: () => ({
      from: (table: string) => {
        if (table === 'categories') {
          return {
            select: () => ({
              ilike: () => ({
                maybeSingle: async () => ({ data: { id: 'cat-1', name: 'Pet' }, error: null }),
              }),
            }),
            insert: async () => ({ error: null }),
          }
        }
        return {
          insert: (data: any) => ({
            select: () => ({
              single: async () => ({ data: { id: 'uuid-bulk', ...data }, error: null }),
            }),
          }),
        }
      },
    }),
  }
}

describe('saveBulkTransactions', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('saves eligible items and returns correct counts', async () => {
    vi.doMock('../../src/db/supabase.js', makeDbMock)

    const { saveBulkTransactions } = await import('../../src/tools/save-bulk-transactions.js')
    const items = [
      makeItem({ category: 'Pet', amount: 80 }),
      makeItem({ category: 'Streaming', amount: 44.90, description: 'NETFLIX' }),
      makeItem({ isPayment: true, amount: 1340.84, description: 'PAGAMENTO' }),
      makeItem({ isCharge: true, amount: 72.94, description: 'ENCARGOS', category: 'Charge' }),
    ]

    const result = await saveBulkTransactions('+5511999990000', items, {})
    // charges are now saved (isCharge items included, only isPayment skipped)
    expect(result.saved).toBe(3)
    expect(result.total).toBe(3)
    expect(result.breakdown['Pet']).toBeCloseTo(80)
    expect(result.breakdown['Streaming']).toBeCloseTo(44.90)
    expect(result.breakdown['Charge']).toBeCloseTo(72.94)
  })

  it('applies approved categories override', async () => {
    vi.doMock('../../src/db/supabase.js', makeDbMock)

    const { saveBulkTransactions } = await import('../../src/tools/save-bulk-transactions.js')
    const items = [
      makeItem({ category: null, amount: 99, description: 'MERCEARIA DO ZE' }),
    ]

    const result = await saveBulkTransactions('+5511999990000', items, { 0: 'Supermarket' })
    expect(result.saved).toBe(1)
    expect(result.breakdown['Supermarket']).toBeCloseTo(99)
  })

  it('returns empty result when all items are payments', async () => {
    vi.doMock('../../src/db/supabase.js', makeDbMock)

    const { saveBulkTransactions } = await import('../../src/tools/save-bulk-transactions.js')
    const items = [
      makeItem({ isPayment: true }),
      makeItem({ isPayment: true }),
    ]

    const result = await saveBulkTransactions('+5511999990000', items, {})
    expect(result.saved).toBe(0)
    expect(result.total).toBe(0)
    expect(result.breakdown).toEqual({})
  })

  it('uses Others as fallback when category is null and no override', async () => {
    vi.doMock('../../src/db/supabase.js', makeDbMock)

    const { saveBulkTransactions } = await import('../../src/tools/save-bulk-transactions.js')
    const items = [
      makeItem({ category: null }),
    ]

    const result = await saveBulkTransactions('+5511999990000', items, {})
    expect(result.saved).toBe(1)
    expect(result.breakdown['Others']).toBeCloseTo(80)
  })
})
