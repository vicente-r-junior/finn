import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}))

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'R$20 · Alimentação · Mastercard · Me · hoje — confirma? ✅',
              tool_calls: null,
            },
          }],
        }),
      },
    }
  },
}))

describe('runAgent', () => {
  it('returns a reply string', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'test-key'

    const { runAgent } = await import('../src/agent.js')
    const result = await runAgent({
      phone: '+5511999990000',
      message: 'gastei 20 no almoço',
      mediaType: 'text',
    })
    expect(result.reply).toBeTruthy()
    expect(typeof result.reply).toBe('string')
  })
})
