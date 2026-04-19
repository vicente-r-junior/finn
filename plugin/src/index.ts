import { runAgent } from './agent.js'

function register(api: any): void {
  console.log('[finance-agent] register() called — plugin initializing')
  console.log('[finance-agent] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'MISSING')
  console.log('[finance-agent] SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING')
  console.log('[finance-agent] SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'MISSING')

  // Register before_agent_reply hook — intercepts WhatsApp messages BEFORE
  // the built-in web-auto-reply LLM runs. First handler to return { handled: true } wins,
  // so the LLM is completely bypassed and only Finn's reply reaches the user.
  api.on('before_agent_reply', async (event: any, ctx: any) => {
    const channelId = (ctx.channelId ?? ctx.messageProvider ?? '').toLowerCase()

    // Only handle WhatsApp, skip heartbeats
    if (!channelId.includes('whatsapp')) return
    if (ctx.trigger === 'heartbeat') return

    const message = (event.cleanedBody ?? '').trim()
    if (!message) return

    // Extract phone from sessionKey: could be "+55...", "whatsapp:+55...", "personal:+55..."
    const rawKey = ctx.sessionKey ?? ''
    const phone = rawKey.includes(':') ? rawKey.split(':').slice(1).join(':') : rawKey

    console.log(`[finn] before_agent_reply — channelId=${channelId} sessionKey=${rawKey} phone=${phone} msg="${message.substring(0, 60)}"`)

    if (!phone) {
      console.log('[finn] WARNING: no phone found in sessionKey, skipping')
      return
    }

    try {
      const result = await runAgent({ phone, message, mediaType: 'text' })
      console.log(`[finn] reply: ${result.reply.substring(0, 120)}`)
      return { handled: true, reply: { text: result.reply } }
    } catch (err) {
      console.error('[finn] ERROR in before_agent_reply:', err)
      return { handled: true, reply: { text: 'Sorry, something went wrong. Please try again.' } }
    }
  })

  console.log('[finance-agent] before_agent_reply hook registered ✓')
}

export { register }
export default register
module.exports = register
module.exports.register = register
module.exports.default = register
