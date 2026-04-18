import { runAgent } from './agent.js'
import type { AgentInput } from './types.js'

// OpenClaw plugin entry point
// Registers the finance_agent tool with the OpenClaw gateway

const plugin = {
  name: 'finance-agent',
  version: '1.0.0',

  tools: [
    {
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
    },
  ],
}

export default plugin
