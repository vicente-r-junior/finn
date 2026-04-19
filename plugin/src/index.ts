import { runAgent } from './agent.js'
import type { AgentInput } from './types.js'

function register(api: any): void {
  console.log('[finance-agent] register() called — plugin initializing')
  console.log('[finance-agent] OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? 'SET' : 'MISSING')
  console.log('[finance-agent] SUPABASE_URL:', process.env.SUPABASE_URL ? 'SET' : 'MISSING')
  console.log('[finance-agent] SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'SET' : 'MISSING')

  api.registerTool({
    name: 'finance_agent',
    description:
      'Personal finance assistant Finn. MUST be called for every WhatsApp message. Handles expense/income logging, credit card tracking, and spending queries.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Sender WhatsApp number with country code (e.g. +5511999990000)',
        },
        message: {
          type: 'string',
          description: 'The exact text of the message',
        },
        mediaType: {
          type: 'string',
          enum: ['text', 'audio', 'image', 'pdf'],
          description: 'Type of media (default: text)',
        },
        mediaData: {
          type: 'string',
          description: 'Base64 encoded content for audio/image/pdf only',
        },
      },
      required: ['phone', 'message'],
    },

    handler: async (params: AgentInput) => {
      console.log('[finance-agent] handler called! phone:', params.phone, 'message:', params.message)
      try {
        const result = await runAgent(params)
        console.log('[finance-agent] reply:', result.reply)
        return result.reply
      } catch (err) {
        console.error('[finance-agent] ERROR:', err)
        return 'Sorry, I had an internal error. Please try again.'
      }
    },
  })

  console.log('[finance-agent] finance_agent tool registered ✓')
}

export { register }
export default register
module.exports = register
module.exports.register = register
module.exports.default = register
