import { describe, it, expect } from 'vitest'

describe('resolveCard', () => {
  it('detects explicit card mentions', async () => {
    const { resolveCard } = await import('../src/cards.js')
    expect(resolveCard('gastei 40 mastercard')).toBe('Mastercard')
    expect(resolveCard('almoco master')).toBe('Mastercard')
    expect(resolveCard('farmacia visa')).toBe('Visa')
    expect(resolveCard('uber aeternum')).toBe('Aeternum')
  })

  it('returns default card when no card mentioned', async () => {
    const { resolveCard } = await import('../src/cards.js')
    expect(resolveCard('gastei 20 no almoço')).toBe('Mastercard')
  })

  it('returns null for cash/pix keywords', async () => {
    const { resolveCard } = await import('../src/cards.js')
    expect(resolveCard('paguei 20 no pix')).toBeNull()
    expect(resolveCard('dinheiro 50 farmacia')).toBeNull()
    expect(resolveCard('pagou debito')).toBeNull()
  })
})

describe('detectDuplicates', () => {
  it('flags transactions with same card, close amount and date', async () => {
    const { detectDuplicates } = await import('../src/cards.js')
    const existing = [
      { id: '1', amount: 40.00, date: '2026-04-18', card: 'Mastercard', description: 'restaurante' },
      { id: '2', amount: 134.50, date: '2026-04-15', card: 'Mastercard', description: 'supermercado' },
    ]
    const incoming = [
      { amount: 40.00, date: '2026-04-18', card: 'Mastercard', description: 'RESTAURANTE ABC' },
      { amount: 200.00, date: '2026-04-20', card: 'Mastercard', description: 'diferente' },
    ]
    const dupes = detectDuplicates(incoming as any, existing as any)
    expect(dupes).toHaveLength(1)
    expect(dupes[0].existingId).toBe('1')
  })
})
