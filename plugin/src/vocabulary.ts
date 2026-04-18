import { db } from './db/supabase.js'
import type { VocabularyEntry, CardName, CostCenter } from './types.js'

export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export async function loadVocabulary(phone: string): Promise<VocabularyEntry[]> {
  const { data, error } = await db()
    .from('vocabulary')
    .select('*')
    .eq('phone', phone)

  if (error) return []
  return (data ?? []) as VocabularyEntry[]
}

export async function learnMapping(
  phone: string,
  term: string,
  category: string,
  card: CardName | null,
  cost_center: CostCenter | null,
  confidenceDelta = 1
): Promise<void> {
  const normalized = normalizeTerm(term)

  let newConfidence = confidenceDelta
  try {
    const { data: existing } = await db()
      .from('vocabulary')
      .select('id, confidence')
      .eq('phone', phone)
      .eq('term', normalized)
      .single()

    if (existing) {
      newConfidence = (existing as any).confidence + confidenceDelta
    }
  } catch {
    // Fall back to confidenceDelta if the existing check fails
  }

  await db().from('vocabulary').upsert(
    {
      phone,
      term: normalized,
      category,
      card,
      cost_center,
      confidence: newConfidence,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone,term' }
  )
}

export async function correctMapping(
  phone: string,
  term: string,
  newCategory: string,
  card: CardName | null,
  cost_center: CostCenter | null
): Promise<void> {
  const normalized = normalizeTerm(term)
  await db().from('vocabulary').upsert(
    {
      phone,
      term: normalized,
      category: newCategory,
      card,
      cost_center,
      confidence: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone,term' }
  )
}

export function extractTermsFromDescription(description: string): string[] {
  const stopWords = new Set(['no', 'na', 'em', 'de', 'do', 'da', 'um', 'uma', 'the', 'for', 'in'])
  return description
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeTerm)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
}
