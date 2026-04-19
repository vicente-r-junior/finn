import { runAgent } from './agent.js'
import type { AgentInput } from './types.js'

// OpenClaw plugin entry point — CommonJS compatible
// OpenClaw calls register(api) on startup

function register(api: any): void {
  api.registerTool({
    name: 'finance_agent',
    description:
      'Personal finance assistant Finn. Handles expense/income logging, credit card tracking, and spending queries via natural conversation.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'User WhatsApp phone number (e.g. +5511999990000)',
        },
        message: {
          type: 'string',
          description: 'The text content of the message (after media processing if applicable)',
        },
        mediaType: {
          type: 'string',
          enum: ['text', 'audio', 'image', 'pdf'],
          description: 'Type of the original media',
        },
        mediaData: {
          type: 'string',
          description: 'Base64 encoded media content (for audio/image/pdf)',
        },
      },
      required: ['phone', 'message'],
    },

    handler: async (params: AgentInput) => {
      const result = await runAgent(params)
      return result.reply
    },
  })
}

// Support both named export and module.exports for maximum compatibility
export { register }
export default register
module.exports = register
module.exports.register = register
module.exports.default = register
