import OpenAI from 'openai'
import { loadState, saveState, appendMessage } from './state.js'
import { loadVocabulary, learnMapping, extractTermsFromDescription } from './vocabulary.js'
import { buildSystemPrompt } from './prompts.js'
import { processMedia } from './media.js'
import { saveTransaction } from './tools/save-transaction.js'
import { querySpending } from './tools/query-spending.js'
import { updateTransaction, findTransaction } from './tools/update-transaction.js'
import { deleteTransaction } from './tools/delete-transaction.js'
import type { AgentInput, AgentResult } from './types.js'

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'save_transaction',
      description: 'Save a confirmed expense, income, or card payment to the database. Only call after user explicitly confirms.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['expense', 'income', 'card_payment'] },
          amount: { type: 'number', description: 'Always positive' },
          description: { type: 'string' },
          category: { type: 'string' },
          cost_center: { type: 'string', enum: ['Me', 'Lilian'] },
          card: {
            type: 'string',
            description: 'Payment method. Default: Mastercard. Known values: Mastercard, Visa, Aeternum, Itaú, Bradesco, Nu, C6. Accept any user-defined account name. null for Cash/PIX.',
            nullable: true
          },
          date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
          source: { type: 'string', enum: ['text', 'audio', 'pdf', 'image'] },
        },
        required: ['type', 'amount', 'category', 'cost_center', 'date', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_spending',
      description: 'Query the user spending history. Use for questions like "how much did I spend this month?"',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['week', 'month', 'year', 'all'] },
          category: { type: 'string' },
          cost_center: { type: 'string' },
          card: { type: 'string' },
          type: { type: 'string', enum: ['expense', 'income', 'card_payment'] },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_transaction',
      description: 'Update a saved transaction. Only call after user confirms the change.',
      parameters: {
        type: 'object',
        properties: {
          description_hint: { type: 'string', description: 'Keyword to find the transaction' },
          amount: { type: 'number' },
          category: { type: 'string' },
          cost_center: { type: 'string' },
          card: { type: 'string' },
          date: { type: 'string' },
        },
        required: ['description_hint'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_transaction',
      description: 'Delete a saved transaction by ID. Only call after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string' },
        },
        required: ['transaction_id'],
      },
    },
  },
]

let _openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY ?? ''
    _openai = new OpenAI({ apiKey })
  }
  return _openai
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const openai = getOpenAI()

  // 1. Process media
  let userText = input.message
  if (input.mediaType && input.mediaType !== 'text' && input.mediaData) {
    const buffer = Buffer.from(input.mediaData, 'base64')
    userText = await processMedia(input.mediaType, buffer)
    userText = `[${input.mediaType.toUpperCase()}] ${userText}`
  }

  // 2. Load state + vocabulary (parallel)
  const [state0, vocabulary] = await Promise.all([
    loadState(input.phone),
    loadVocabulary(input.phone),
  ])
  let state = state0

  // 3. Append user message to history
  state = appendMessage(state, 'user', userText)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(vocabulary, new Date().toISOString().split('T')[0]) },
    ...state.history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
  ]

  // 4. OpenAI tool-use loop
  let finalReply = ''
  let iterations = 0
  const maxIterations = 5

  while (iterations < maxIterations) {
    iterations++
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    })

    const choice = response.choices[0]
    if (!choice) break

    const assistantMsg = choice.message
    messages.push(assistantMsg)

    // No tool calls — final text reply
    if (!assistantMsg.tool_calls?.length) {
      finalReply = assistantMsg.content ?? ''
      break
    }

    // Execute tool calls
    for (const toolCall of assistantMsg.tool_calls) {
      const args = JSON.parse(toolCall.function.arguments)
      let toolResult = ''

      try {
        if (toolCall.function.name === 'save_transaction') {
          const tx = await saveTransaction({ ...args, phone: input.phone, raw_input: input.message })
          toolResult = JSON.stringify({ success: true, id: tx.id, amount: tx.amount, category: tx.category })

          // Learn vocabulary from confirmed transaction
          if (args.description) {
            const terms = extractTermsFromDescription(args.description)
            for (const term of terms) {
              await learnMapping(input.phone, term, args.category, args.card ?? null, args.cost_center ?? null)
            }
          }

          state.state = 'idle'
          state.pending_transaction = null
        } else if (toolCall.function.name === 'query_spending') {
          const result = await querySpending({ phone: input.phone, ...args })
          toolResult = JSON.stringify(result)
        } else if (toolCall.function.name === 'update_transaction') {
          const { description_hint, ...fields } = args
          const found = await findTransaction(input.phone, description_hint)
          if (!found) {
            toolResult = JSON.stringify({ error: 'Transaction not found. Ask user to be more specific.' })
          } else {
            const updated = await updateTransaction(found.id, fields)
            toolResult = JSON.stringify({ success: true, ...updated })
            state.state = 'idle'
          }
        } else if (toolCall.function.name === 'delete_transaction') {
          await deleteTransaction(args.transaction_id)
          toolResult = JSON.stringify({ success: true })
          state.state = 'idle'
        }
      } catch (err) {
        toolResult = JSON.stringify({ error: (err as Error).message })
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      })
    }
  }

  // 5. Prepend transcription echo for audio messages (always, regardless of tool use)
  if (input.mediaType === 'audio' && userText) {
    const transcribedText = userText.replace(/^\[AUDIO\]\s*/, '').trim()
    if (transcribedText) {
      finalReply = `🎙️ _"${transcribedText}"_\n\n${finalReply}`
    }
  }

  // 6. Persist state + history
  state = appendMessage(state, 'assistant', finalReply)
  await saveState(state)

  return { reply: finalReply }
}
