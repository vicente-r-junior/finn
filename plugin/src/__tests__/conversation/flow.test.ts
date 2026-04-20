import { describe, it, expect, afterAll } from 'vitest'
import { runAgent } from '../../agent.js'
import { db } from '../../db/supabase.js'

const TEST_PHONE = '+5500000000002'

afterAll(async () => {
  if (!process.env.SUPABASE_URL) return
  await db().from('transactions').delete().eq('phone', TEST_PHONE)
})

describe('conversation flow', () => {
  it('logs 189 on lunch — defaults to Mastercard without asking', async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set — skipping conversation test')
      return
    }

    // Turn 1: user says "189 on lunch"
    const turn1 = await runAgent({
      phone: TEST_PHONE,
      message: '189 on lunch',
      mediaType: 'text',
    })

    const reply1 = turn1.reply

    // Agent should NOT ask about which card
    const asksAboutCard =
      /which card|qual cart|what card|mastercard.*visa.*nu|visa.*mastercard/i.test(reply1)
    expect(asksAboutCard).toBe(false)

    // Agent should show confirmation summary with Mastercard as default
    expect(reply1).toMatch(/R\$189/)
    expect(reply1).toMatch(/Food/i)
    expect(reply1).toMatch(/Mastercard/i)

    // Turn 2: user confirms
    const turn2 = await runAgent({
      phone: TEST_PHONE,
      message: 'yeah',
      mediaType: 'text',
    })

    const reply2 = turn2.reply

    // Should not error
    expect(reply2).toBeTruthy()
    expect(reply2).not.toMatch(/error|failed|falhou/i)
  })
})
