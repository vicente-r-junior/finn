// Finn Finance Agent — Message Hook
// Fires on every message:received event and calls runAgent directly

import { runAgent } from '/root/.openclaw/extensions/finance-agent/dist/agent.js'

const handler = async (event: any) => {
  if (event.type !== 'message' || event.action !== 'received') return

  const phone: string = event.context?.from ?? ''
  const content: string = event.context?.content ?? ''
  const channelId: string = event.context?.channelId ?? ''

  // Only handle WhatsApp messages
  if (!channelId.includes('whatsapp') && channelId !== 'whatsapp') return
  if (!phone || !content) return

  console.log(`[finn-handler] message from ${phone}: ${content}`)

  try {
    const result = await runAgent({ phone, message: content, mediaType: 'text' })
    console.log(`[finn-handler] reply: ${result.reply}`)
    event.messages.push(result.reply)
  } catch (err) {
    console.error('[finn-handler] ERROR:', err)
    event.messages.push('Sorry, something went wrong. Please try again.')
  }
}

export default handler
