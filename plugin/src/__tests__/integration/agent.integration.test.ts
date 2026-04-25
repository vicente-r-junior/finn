import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { saveTransaction } from '../../tools/save-transaction.js'
import { db } from '../../db/supabase.js'
import type { CostCenter, CardName, TransactionType, MediaSource } from '../../types.js'

const TEST_PHONE = '+5500000000001'

const hasSupabase = !!process.env.SUPABASE_URL

beforeAll(() => {
  if (!hasSupabase) {
    console.warn('SUPABASE_URL not set — skipping integration tests')
  }
})

afterEach(async () => {
  if (!hasSupabase) return
  await db().from('transactions').delete().eq('phone', TEST_PHONE)
})

const baseParams: {
  phone: string
  type: TransactionType
  amount: number
  description: string
  category: string
  cost_center: CostCenter
  date: string
  source: MediaSource
  raw_input: string
  card: CardName | null
} = {
  phone: TEST_PHONE,
  type: 'expense',
  amount: 50,
  description: 'Test transaction',
  category: 'Food',
  cost_center: 'Me',
  date: '2026-04-20',
  source: 'text',
  raw_input: 'test raw input',
  card: 'Mastercard',
}

describe('saveTransaction', () => {
  it('saveTransaction with Mastercard', async () => {
    if (!hasSupabase) return
    const result = await saveTransaction({ ...baseParams, card: 'Mastercard' })
    expect(result).toBeTruthy()
    expect(result.phone).toBe(TEST_PHONE)
    expect(result.card).toBe('Mastercard')
    expect(result.amount).toBe(50)
    expect(result.category).toBe('Food')
    expect(result.cost_center).toBe('Me')
    expect(result.type).toBe('expense')
  })

  it('saveTransaction with Nu', async () => {
    if (!hasSupabase) return
    const result = await saveTransaction({ ...baseParams, card: 'Nu' })
    expect(result).toBeTruthy()
    expect(result.card).toBe('Nu')
    expect(result.phone).toBe(TEST_PHONE)
  })

  it('saveTransaction with null card (Cash/PIX)', async () => {
    if (!hasSupabase) return
    const result = await saveTransaction({ ...baseParams, card: null })
    expect(result).toBeTruthy()
    expect(result.card).toBeNull()
    expect(result.phone).toBe(TEST_PHONE)
  })

  it('date is stored correctly', async () => {
    if (!hasSupabase) return
    const date = '2026-04-20'
    const result = await saveTransaction({ ...baseParams, card: 'Mastercard', date })
    expect(result).toBeTruthy()
    // Date may come back as full ISO string or YYYY-MM-DD — check it contains the expected date
    expect(String(result.date)).toContain(date)
  })
})
