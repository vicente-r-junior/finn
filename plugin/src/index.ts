import { runAgent } from './agent.js'

function register(api: any): void {
  console.log('[finance-agent] register() called — plugin initializing')
  console.log('[finance-agent] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'MISSING')
  console.log('[finance-agent] SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING')
  console.log('[finance-agent] SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'MISSING')

  // Register before_dispatch hook — fires before the message is dispatched to the LLM.
  // This hook receives senderId (the actual WhatsApp phone number) and can short-circuit
  // the entire LLM pipeline. First handler to return { handled: true } wins.
  api.on('before_dispatch', async (event: any, ctx: any) => {
    const channelId = (ctx.channelId ?? event.channel ?? '').toLowerCase()

    // Only handle WhatsApp direct messages
    if (!channelId.includes('whatsapp')) return
    if (event.isGroup) return

    // senderId is the sender's WhatsApp phone number e.g. "+553491623351"
    const phone = ctx.senderId ?? event.senderId ?? ''
    if (!phone) {
      console.log('[finn] WARNING: no senderId in before_dispatch ctx, skipping')
      return
    }

    const message = (event.content ?? '').trim()
    if (!message) return

    console.log(`[finn] before_dispatch — phone=${phone} msg="${message.substring(0, 60)}"`)

    try {
      const result = await runAgent({ phone, message, mediaType: 'text' })
      console.log(`[finn] reply: ${result.reply.substring(0, 120)}`)
      return { handled: true, text: result.reply }
    } catch (err) {
      console.error('[finn] ERROR in before_dispatch:', err)
      return { handled: true, text: 'Sorry, something went wrong. Please try again.' }
    }
  })

  console.log('[finance-agent] before_dispatch hook registered ✓')
}

export { register }
export default register
module.exports = register
module.exports.register = register
module.exports.default = register
