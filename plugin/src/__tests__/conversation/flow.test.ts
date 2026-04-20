import { describe, it, expect, afterAll } from 'vitest'
import { runAgent } from '../../agent.js'
import { db } from '../../db/supabase.js'

const TEST_PHONE = '+5500000000002'

afterAll(async () => {
  if (!process.env.SUPABASE_URL) return
  await db().from('transactions').delete().eq('phone', TEST_PHONE)
})

describe('conversation flow', () => {
  it('logs 189 on lunch — defaults to Mastercard without asking', { timeout: 30000 }, async () => {
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

  it('SCENARIO 1 — "spent 80 today" defaults to Mastercard, no card question', { timeout: 30000 }, async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set — skipping')
      return
    }

    const turn1 = await runAgent({
      phone: TEST_PHONE,
      message: 'spent 80 today',
      mediaType: 'text',
    })

    console.log('[TEST] reply to "spent 80 today":', turn1.reply)

    // Agent MUST ask what it was for (no description) — but NOT ask about card
    const asksAboutCard = /which card|qual cart[ã|a]o|what card/i.test(turn1.reply)
    expect(asksAboutCard).toBe(false)

    // Provide description
    const turn2 = await runAgent({
      phone: TEST_PHONE,
      message: 'pharmacy',
      mediaType: 'text',
    })

    console.log('[TEST] reply after "pharmacy":', turn2.reply)

    // Now agent should show summary WITH Mastercard, no card question
    const asksAboutCard2 = /which card|qual cart[ã|a]o|what card/i.test(turn2.reply)
    expect(asksAboutCard2).toBe(false)
    expect(turn2.reply).toMatch(/Mastercard/i)
    expect(turn2.reply).toMatch(/R\$80/)
  })

  it('SCENARIO 3 — audio message shows transcription echo with mic emoji', { timeout: 30000 }, async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set — skipping')
      return
    }

    // Simulate what the agent will receive after Whisper transcribes a voice note
    const turn1 = await runAgent({
      phone: TEST_PHONE,
      message: '[AUDIO] gastei noventa no mercado hoje',
      mediaType: 'text', // already transcribed — just testing the echo behaviour
    })

    console.log('[TEST] reply to audio message:', turn1.reply)

    // Must start with the mic echo
    expect(turn1.reply).toMatch(/🎙/)
    // Must show the transcription in italic
    expect(turn1.reply).toMatch(/_".*gastei.*mercado.*"_/i)
    // Must still show the transaction summary
    expect(turn1.reply).toMatch(/R\$90/)
    expect(turn1.reply).toMatch(/Mastercard/i)
  })

  it('SCENARIO 2 — new category "Insurance" is accepted without rejection', { timeout: 30000 }, async () => {
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY not set — skipping')
      return
    }

    // User logs an expense with an unlisted category
    const turn1 = await runAgent({
      phone: TEST_PHONE,
      message: 'paid 350 for insurance',
      mediaType: 'text',
    })

    console.log('[TEST] reply to "paid 350 for insurance":', turn1.reply)

    // Agent must NOT say it only accepts certain categories
    const rejectsCategory = /only accept|I only|not a valid|categorias aceitas|categorias válidas/i.test(turn1.reply)
    expect(rejectsCategory).toBe(false)

    // Agent should show 350 and Insurance in the summary
    expect(turn1.reply).toMatch(/R\$350/)
    expect(turn1.reply).toMatch(/Insurance/i)
    expect(turn1.reply).toMatch(/Mastercard/i)

    // Confirm
    const turn2 = await runAgent({
      phone: TEST_PHONE,
      message: 'yes',
      mediaType: 'text',
    })

    console.log('[TEST] reply after confirming insurance:', turn2.reply)

    expect(turn2.reply).toBeTruthy()
    expect(turn2.reply).not.toMatch(/error|failed|falhou/i)
  })
})
