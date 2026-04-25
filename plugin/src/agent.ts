import OpenAI from 'openai'
import { loadState, saveState, appendMessage } from './state.js'
import { loadVocabulary, learnMapping, extractTermsFromDescription } from './vocabulary.js'
import { buildSystemPrompt } from './prompts.js'
import { processMedia } from './media.js'
import { saveTransaction } from './tools/save-transaction.js'
import { querySpending } from './tools/query-spending.js'
import { updateTransaction, findTransaction } from './tools/update-transaction.js'
import { deleteTransaction } from './tools/delete-transaction.js'
import { saveBulkTransactions } from './tools/save-bulk-transactions.js'
import { saveBankTransactions } from './tools/save-bank-transactions.js'
import type { AgentInput, AgentResult, InvoiceItem, BankTransaction } from './types.js'

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
          force_save: { type: 'boolean', description: 'Set to true to save even if a duplicate exists (user explicitly confirmed they want to save anyway)' },
        },
        required: ['type', 'amount', 'category', 'cost_center', 'date', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_spending',
      description: 'Query the user spending history. Use for questions like "how much did I spend this month?" or "how much leaves my account in May?" (use caixa view for the latter).',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['week', 'month', 'year', 'all'] },
          category: { type: 'string' },
          cost_center: { type: 'string' },
          card: { type: 'string' },
          type: { type: 'string', enum: ['expense', 'income', 'card_payment'] },
          view: {
            type: 'string',
            enum: ['competencia', 'caixa'],
            description: 'competencia (default): filter by purchase date. caixa: filter by due_date (when money leaves bank account).',
          },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_bulk_transactions',
      description: 'Save all confirmed invoice items from a PDF import in bulk.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of InvoiceItem objects from the parsed PDF',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                isoDate: { type: 'string' },
                description: { type: 'string' },
                installment: { type: 'string', nullable: true },
                amount: { type: 'number' },
                isPayment: { type: 'boolean' },
                isCharge: { type: 'boolean' },
                category: { type: 'string', nullable: true },
                cost_center: { type: 'string', enum: ['Me', 'Lilian'] },
                card: { type: 'string' },
                cardHolder: { type: 'string' },
                due_date: { type: 'string' },
                billing_cycle: { type: 'string' },
              },
              required: ['date', 'isoDate', 'description', 'amount', 'isPayment', 'isCharge', 'cost_center', 'card', 'cardHolder', 'due_date', 'billing_cycle'],
            },
          },
          card: { type: 'string', description: 'Card name for reference' },
          due_date: { type: 'string', description: 'Invoice due date YYYY-MM-DD (from dueDate field in JSON)' },
          billing_cycle: { type: 'string', description: 'YYYY-MM billing cycle (from billingCycle field in JSON)' },
          approved_categories: {
            type: 'object',
            description: 'Map of item index to category override',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['items'],
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
  {
    type: 'function',
    function: {
      name: 'save_bank_statement',
      description: 'Save all confirmed transactions from a bank account statement PDF. Only call after user confirms.',
      parameters: {
        type: 'object',
        properties: {
          transactions: {
            type: 'array',
            description: 'Array of BankTransaction objects from the parsed PDF',
            items: {
              type: 'object',
              properties: {
                date:           { type: 'string', description: 'YYYY-MM-DD' },
                description:    { type: 'string' },
                amount:         { type: 'number' },
                type:           { type: 'string', enum: ['expense', 'income', 'card_payment'] },
                category:       { type: 'string' },
                card:           { type: 'string' },
                due_date:       { type: 'string' },
                billing_cycle:  { type: 'string' },
              },
              required: ['date', 'description', 'amount', 'type', 'category', 'card', 'due_date', 'billing_cycle'],
            },
          },
          bank: { type: 'string', description: 'Bank name e.g. "Bradesco"' },
        },
        required: ['transactions'],
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
  // For PDF invoices: reset any stale pending state and strip old PDF payloads from history
  // so they don't pollute the context or cause old pending transactions to be confirmed.
  if (userText.startsWith('[PDF_INVOICE]')) {
    state.state = 'idle'
    state.pending_transaction = null
    state.history = state.history.filter(m => !m.content.startsWith('[PDF_INVOICE]'))
  }
  if (userText.startsWith('[PDF_STATEMENT]')) {
    state.state = 'idle'
    state.pending_transaction = null
    state.history = state.history.filter(m => !m.content.startsWith('[PDF_STATEMENT]'))
  }
  state = appendMessage(state, 'user', userText)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(vocabulary, new Date().toISOString().split('T')[0]) },
    ...state.history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
  ]

  // 4. OpenAI tool-use loop
  let finalReply = ''
  let iterations = 0
  const maxIterations = 5

  const model = 'gpt-4.1'

  // If the message looks like a spending/balance question, force query_spending as the
  // first tool call so the LLM cannot answer from context or memory — even when a PDF
  // was just saved and the model "knows" what categories it contained.
  const SPENDING_Q_RE = /how much|quanto (gastei|ganhei|paguei|saiu|vence|entrou)|what.*spent|spent.*month|breakdown|gastos|despesas|receitas|renda|saldo|transport|food|shopping|category|categoria/i
  let toolChoice: OpenAI.Chat.ChatCompletionToolChoiceOption =
    SPENDING_Q_RE.test(userText) ? { type: 'function', function: { name: 'query_spending' } } : 'auto'

  while (iterations < maxIterations) {
    iterations++
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: TOOLS,
      tool_choice: toolChoice,
    })
    // After the forced first call, let the LLM decide freely for subsequent turns
    toolChoice = 'auto'

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
          // Check for duplicate before saving
          const dupCheck = await (async () => {
            try {
              const { db } = await import('./db/supabase.js')
              const d = new Date(args.date)
              const from = new Date(d); from.setDate(from.getDate() - 3)
              const to = new Date(d); to.setDate(to.getDate() + 3)
              const { data } = await db()
                .from('transactions')
                .select('id, description, amount, date, card')
                .eq('phone', input.phone)
                .eq('card', args.card ?? 'Mastercard')
                .gte('amount', args.amount - 0.01)
                .lte('amount', args.amount + 0.01)
                .gte('date', from.toISOString().split('T')[0])
                .lte('date', to.toISOString().split('T')[0])
              return data?.[0] ?? null
            } catch { return null }
          })()
          if (dupCheck && !args.force_save) {
            toolResult = JSON.stringify({ duplicate: true, existingId: dupCheck.id, existingDescription: dupCheck.description, existingDate: dupCheck.date, amount: dupCheck.amount, message: 'A similar transaction already exists. Warn the user and ask if they still want to save. If yes, call save_transaction again with force_save: true.' })
          } else {
            const tx = await saveTransaction({ ...args, phone: input.phone, raw_input: input.message })
            toolResult = JSON.stringify({ success: true, id: tx.id, amount: tx.amount, category: tx.category })

            // Learn vocabulary only from actually-saved transactions (not duplicate-skipped ones)
            if (args.description) {
              const terms = extractTermsFromDescription(args.description)
              for (const term of terms) {
                await learnMapping(input.phone, term, args.category, args.card ?? null, args.cost_center ?? null)
              }
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
            const updated = await updateTransaction(input.phone, found.id, fields)
            toolResult = JSON.stringify({ success: true, ...updated })
            state.state = 'idle'
          }
        } else if (toolCall.function.name === 'delete_transaction') {
          await deleteTransaction(input.phone, args.transaction_id)
          toolResult = JSON.stringify({ success: true })
          state.state = 'idle'
        } else if (toolCall.function.name === 'save_bulk_transactions') {
          const items: InvoiceItem[] = args.items ?? []
          const approvedCategories: Record<number, string> = args.approved_categories ?? {}
          const result = await saveBulkTransactions(input.phone, items, approvedCategories, args.due_date, args.billing_cycle, args.card)
          toolResult = JSON.stringify({ success: true, ...result })
          state.state = 'idle'
          // Purge the large PDF payload from history after save to avoid context bloat
          state.history = state.history.filter(m => !m.content.startsWith('[PDF_INVOICE]'))
        } else if (toolCall.function.name === 'save_bank_statement') {
          const transactions: BankTransaction[] = args.transactions ?? []
          const result = await saveBankTransactions(input.phone, transactions)
          toolResult = JSON.stringify({ success: true, ...result })
          state.state = 'idle'
          // Purge the bank statement payload from history after save
          state.history = state.history.filter(m => !m.content.startsWith('[PDF_STATEMENT]'))
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

  // If the loop exhausted iterations without a text reply, ask the user to retry
  if (!finalReply) {
    finalReply = "Sorry, I couldn't complete that. Could you try again?"
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
