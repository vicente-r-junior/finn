import { describe, it, expect, vi } from 'vitest'
import type { VocabularyEntry } from '../src/types.js'

const mockVocab: VocabularyEntry[] = [
  { id: '1', phone: '+55', term: 'buteco', category: 'Bar', card: null, cost_center: null, confidence: 3 },
  { id: '2', phone: '+55', term: 'almoco', category: 'Alimentação', card: null, cost_center: null, confidence: 2 },
]

vi.mock('../src/db/supabase.js', () => {
  const makeChain = (resolveValue: any) => {
    const chain: any = {
      eq: () => makeChain(resolveValue),
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      upsert: async () => ({ error: null }),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolveValue).then(onFulfilled, onRejected),
      catch: (onRejected: any) => Promise.resolve(resolveValue).catch(onRejected),
    }
    return chain
  }
  return {
    db: () => ({
      from: () => ({
        select: () => makeChain({ data: mockVocab, error: null }),
        upsert: async () => ({ error: null }),
      }),
    }),
  }
})

describe('loadVocabulary', () => {
  it('returns vocabulary for phone', async () => {
    const { loadVocabulary } = await import('../src/vocabulary.js')
    const vocab = await loadVocabulary('+55')
    expect(vocab).toHaveLength(2)
    expect(vocab[0].term).toBe('buteco')
  })
})

describe('normalizeTerm', () => {
  it('lowercases and strips accents', async () => {
    const { normalizeTerm } = await import('../src/vocabulary.js')
    expect(normalizeTerm('Almoço')).toBe('almoco')
    expect(normalizeTerm('BUTECO')).toBe('buteco')
    expect(normalizeTerm('  farmácia  ')).toBe('farmacia')
  })
})

describe('learnMapping', () => {
  it('upserts vocabulary without throwing', async () => {
    const { learnMapping } = await import('../src/vocabulary.js')
    await expect(
      learnMapping('+55', 'buteco', 'Bar', null, null)
    ).resolves.not.toThrow()
  })
})
