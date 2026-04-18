import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../src/prompts.js'

describe('buildSystemPrompt', () => {
  it('includes Finn identity', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Finn')
  })

  it('includes all cost centers', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Me')
    expect(prompt).toContain('Lilian')
    expect(prompt).toContain('Eddie')
    expect(prompt).toContain('Apto Taman')
    expect(prompt).toContain('Carro')
    expect(prompt).toContain('Família')
  })

  it('includes Mastercard as default card', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Mastercard')
    expect(prompt).toContain('default')
  })

  it('injects vocabulary into prompt', () => {
    const vocab = [
      { term: 'buteco', category: 'Bar', card: null, cost_center: null, confidence: 3 },
    ]
    const prompt = buildSystemPrompt(vocab as any)
    expect(prompt).toContain('buteco')
    expect(prompt).toContain('Bar')
  })

  it('includes state machine rules', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('confirm')
    expect(prompt).toContain('save')
  })
})
