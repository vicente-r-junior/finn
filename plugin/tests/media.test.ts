import { describe, it, expect, vi } from 'vitest'

vi.mock('openai', () => ({
  default: class {
    audio = {
      transcriptions: {
        create: async () => ({ text: 'comprei remédio quarenta e cinco reais' }),
      },
    }
    chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'Receipt: R$45.00 Farmácia 2026-04-18' } }],
        }),
      },
    }
  },
}))

vi.mock('pdf-parse', () => ({
  default: async () => ({
    text: 'FATURA MASTERCARD\nVencimento: 15/05/2026\nFechamento: 16/04/2026\nTotal: R$ 2.340,00\nALIMENTACAO 40,00\nSUPERMERCADO 134,50',
  }),
}))

describe('transcribeAudio', () => {
  it('returns transcript text', async () => {
    const { transcribeAudio } = await import('../src/media.js')
    const result = await transcribeAudio(Buffer.from('fake-audio'), 'audio.ogg')
    expect(result).toBe('comprei remédio quarenta e cinco reais')
  })
})

describe('parseImage', () => {
  it('returns extracted text from image', async () => {
    const { parseImage } = await import('../src/media.js')
    const result = await parseImage('data:image/jpeg;base64,fakeb64')
    expect(result).toContain('45.00')
  })
})

describe('parsePdf', () => {
  it('extracts text from PDF buffer', async () => {
    const { parsePdf } = await import('../src/media.js')
    const result = await parsePdf(Buffer.from('fake-pdf'))
    expect(result).toContain('MASTERCARD')
    expect(result).toContain('2.340,00')
  })
})
