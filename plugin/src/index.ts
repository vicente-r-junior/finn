import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { runAgent } from './agent.js'

const MEDIA_INBOUND_DIR = '/root/.openclaw/media/inbound'

function findLatestAudioFile(): string | null {
  try {
    const files = readdirSync(MEDIA_INBOUND_DIR)
      .filter(f => f.endsWith('.ogg') || f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.opus'))
      .map(f => ({ path: join(MEDIA_INBOUND_DIR, f), mtime: statSync(join(MEDIA_INBOUND_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    return files[0]?.path ?? null
  } catch {
    return null
  }
}

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
    const isAudio = message === '<media:audio>'

    if (!message && !isAudio) return

    console.log(`[finn] before_dispatch — phone=${phone} msg="${message.substring(0, 60)}" isAudio=${isAudio}`)

    try {
      let agentInput: Parameters<typeof runAgent>[0] = { phone, message, mediaType: 'text' }

      if (isAudio) {
        const audioPath = findLatestAudioFile()
        if (!audioPath) {
          console.error('[finn] audio: no file found in inbound dir')
          return { handled: true, text: "I couldn't access your voice note. Please try again or type your message." }
        }
        try {
          const audioBuffer = readFileSync(audioPath)
          agentInput = {
            phone,
            message: '',
            mediaType: 'audio',
            mediaData: audioBuffer.toString('base64'),
          }
          console.log(`[finn] audio loaded: ${audioPath} (${audioBuffer.length} bytes)`)
        } catch (readErr) {
          console.error('[finn] failed to read audio file:', readErr)
          return { handled: true, text: "I couldn't access your voice note. Please try again or type your message." }
        }
      }

      const result = await runAgent(agentInput)
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
