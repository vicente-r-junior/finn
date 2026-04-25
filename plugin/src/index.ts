import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { runAgent } from './agent.js'
import { parsePdf, pdfToImages } from './media.js'
import { parseInvoice } from './tools/parse-invoice.js'
import { parseInvoiceOcr } from './tools/parse-invoice-ocr.js'
import { parseInvoiceBradesco } from './tools/parse-invoice-bradesco.js'
import { parseStatementBradesco } from './tools/parse-statement-bradesco.js'
import { findDuplicates } from './tools/find-duplicates.js'
import type { DuplicateMatch } from './tools/find-duplicates.js'
import { updateCardCycleFromPdf } from './cards.js'
import type { ParsedInvoice } from './types.js'

const MEDIA_INBOUND_DIR = '/root/.openclaw/media/inbound'

// ---------------------------------------------------------------------------
// Invoice helper — builds the [PDF_INVOICE] agent message from a parsed invoice
// ---------------------------------------------------------------------------
function buildInvoiceAgentInput(
  phone: string,
  invoice: ParsedInvoice,
  duplicates: DuplicateMatch[],
  fmtDate: (iso: string) => string,
  fmtAmount: (n: number) => string,
): Parameters<typeof runAgent>[0] {
  console.log(`[finn] pdf: parsed invoice — card=${invoice.card} items=${invoice.items.length} total=${invoice.totalAmount}`)

  // Auto-update closing_day and due_day in credit_cards table from PDF data
  if (invoice.nextClosingDate && invoice.dueDate) {
    const closingDay = parseInt(invoice.nextClosingDate.slice(8, 10))
    const dueDay     = parseInt(invoice.dueDate.slice(8, 10))
    updateCardCycleFromPdf(invoice.card, closingDay, dueDay, invoice.nextClosingDate).catch(err =>
      console.warn('[finn] pdf: failed to update card cycle:', err),
    )
    console.log(`[finn] pdf: updated ${invoice.card} closing_day=${closingDay} due_day=${dueDay}`)
  }

  const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const duplicateIds = new Set(duplicates.map(d => `${d.item.description}|${d.item.amount}|${d.item.isoDate}`))
  const allItems  = invoice.items.filter(i => !i.isPayment)
  const expenses  = allItems.filter(i => !i.isCharge)
  const newCount  = expenses.filter(i => !duplicateIds.has(`${i.description}|${i.amount}|${i.isoDate}`)).length
  const dupCount  = duplicates.length

  // Format due date: "2026-04-25" → "Apr 25, 2026"
  const [dyy, dmm, ddd] = invoice.dueDate.split('-')
  const dueFmt = `${SHORT_MONTHS[parseInt(dmm) - 1]} ${parseInt(ddd)}, ${dyy}`

  // Show "new charges" total (Lançamentos atuais) in the header — this is the amount
  // that matches the sum of parsed items.  The separate "total desta fatura" (totalAmount)
  // may differ because it factors in previous unpaid balance and payments received.
  const headerTotal = invoice.currentChargesTotal > 0 ? invoice.currentChargesTotal : invoice.totalAmount
  const header = `📄 *${invoice.card}* · Due ${dueFmt} · ${fmtAmount(headerTotal)} · ${allItems.length} items (${newCount} new · ${dupCount} skipped)`

  let rowNum = 0
  const rows = allItems.map(item => {
    rowNum++
    const key       = `${item.description}|${item.amount}|${item.isoDate}`
    const isDup     = duplicateIds.has(key)
    const emoji     = item.isCharge ? '⚠️' : item.isInternational ? '🌍' : (isDup ? '⏭️' : '✅')
    const who       = item.cost_center === 'Lilian' ? 'Lilian' : 'Me'
    const cat       = item.isCharge ? 'Charge' : (item.category && item.category !== 'charge' ? item.category : '❓')
    const inst      = item.installment ? ` · ${item.installment}` : ''
    const amountStr = item.isInternational && item.originalCurrency && item.originalAmount
      ? `${fmtAmount(item.amount)} (${item.originalCurrency} ${item.originalAmount.toFixed(2).replace('.', ',')})`
      : fmtAmount(item.amount)
    return `*${rowNum}.* ${emoji} ${item.description}\n  ${fmtDate(item.isoDate)}${inst} · ${amountStr} · ${cat} · ${who}`
  })

  // --- Checksum + Resumo da Fatura breakdown ---
  const itemsSum = allItems.reduce((sum, i) => sum + i.amount, 0)

  // Build Resumo da Fatura line — mirrors the invoice summary table:
  //   Saldo financiado + Encargos + Lançamentos atuais = Total desta fatura
  // e.g.: -1.340,84 + 929,60 + 5.193,48 = 4.782,24
  const resumoLines: string[] = []
  if (invoice.currentChargesTotal > 0) {
    resumoLines.push(`Lançamentos: *${fmtAmount(invoice.currentChargesTotal)}*`)
  }
  if (invoice.saldoFinanciado !== 0) {
    const sign  = invoice.saldoFinanciado > 0 ? '+' : ''
    const label = invoice.saldoFinanciado < 0 ? 'Saldo financiado (crédito)' : 'Saldo financiado'
    resumoLines.push(`${label}: *${sign}${fmtAmount(invoice.saldoFinanciado)}*`)
  }
  if (invoice.encargosFinanciamento > 0) {
    resumoLines.push(`Encargos: *+${fmtAmount(invoice.encargosFinanciamento)}*`)
  }
  if (invoice.paymentReceived > 0) {
    resumoLines.push(`Pagamento recebido: *-${fmtAmount(invoice.paymentReceived)}*`)
  }
  resumoLines.push(`*Total: ${fmtAmount(invoice.totalAmount)}*`)
  const resumoLine = `📊 Resumo da Fatura  ·  ${resumoLines.join('  ·  ')}`

  // Item checksum.
  // When Saldo financiado / Encargos are included as items, sum(amount) = totalAmount.
  // Otherwise (no Resumo items) sum should equal currentChargesTotal.
  const hasResumoItems = invoice.saldoFinanciado !== 0 || invoice.encargosFinanciamento > 0
  const expectedSum    = hasResumoItems
    ? invoice.totalAmount
    : (invoice.currentChargesTotal > 0 ? invoice.currentChargesTotal : invoice.totalAmount)

  let checksumLine: string
  const diff = Math.abs(itemsSum - expectedSum)
  if (diff < 0.50) {
    checksumLine = `✅ *sum(amount) = ${fmtAmount(itemsSum)} — matches invoice total*`
  } else {
    checksumLine = `⚠️ *Items: ${fmtAmount(itemsSum)} · Expected: ${fmtAmount(expectedSum)} · Diff: ${fmtAmount(diff)}* (possible missed item or refund)`
  }

  const formattedTable = [header, '', rows.join('\n\n'), '', checksumLine, resumoLine].join('\n')

  const invoicePayload = JSON.stringify({
    card:           invoice.card,
    cardNumber:     invoice.cardNumber,
    holderName:     invoice.holderName,
    dueDate:        invoice.dueDate,
    billingCycle:   invoice.billingCycle,
    closingDate:    invoice.closingDate,
    totalAmount:    invoice.totalAmount,
    items:          invoice.items,
    duplicates:     duplicates.map(d => ({
      existingId:  d.existingId,
      description: d.item.description,
      amount:      d.item.amount,
      isoDate:     d.item.isoDate,
    })),
  })

  return {
    phone,
    message: `[PDF_INVOICE]\n\nPRE-FORMATTED TABLE — output this VERBATIM to the user, do not summarize or cut:\n${formattedTable}\n\nJSON DATA (use for save_bulk_transactions):\n${invoicePayload}`,
    mediaType: 'text',
  }
}

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

function findLatestPdfFile(): string | null {
  try {
    const files = readdirSync(MEDIA_INBOUND_DIR)
      .filter(f => f.endsWith('.pdf'))
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

    // senderId is the sender's WhatsApp phone number e.g. "+5511999990000"
    const phone = ctx.senderId ?? event.senderId ?? ''
    if (!phone) {
      console.log('[finn] WARNING: no senderId in before_dispatch ctx, skipping')
      return
    }

    // Phone whitelist — only respond to allowed numbers.
    // Set ALLOWED_PHONES as comma-separated list in .env, e.g. "+5511999999999,+5511888888888"
    // If the env var is not set, default to owner-only mode (no strangers get responses).
    const allowedPhones = (process.env.ALLOWED_PHONES ?? '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)

    if (allowedPhones.length > 0 && !allowedPhones.includes(phone)) {
      console.log(`[finn] BLOCKED: message from unknown phone ${phone}`)
      return { handled: true, text: '' }   // silently ignore — no reply at all
    }

    const message = (event.content ?? '').trim()
    const isAudio = message === '<media:audio>'

    // PDF detection: WhatsApp sends PDFs with the caption as content and mimeType=application/pdf.
    // We detect via mimeType/contentType fields, or the legacy '<media:document>' sentinel.
    const mimeType = (event.mimeType ?? event.contentType ?? event.mediaType ?? '').toLowerCase()
    const isPdf =
      message === '<media:document>' ||
      mimeType.includes('pdf') ||
      (message.startsWith('<media:') && !isAudio && message.toLowerCase().includes('pdf'))

    // Caption sent alongside the PDF (e.g. "My visa bill") — use as hint but don't treat as text query
    const caption = isPdf ? message : ''

    if (!message && !isAudio && !isPdf) return

    console.log(`[finn] before_dispatch — phone=${phone} msg="${message.substring(0, 60)}" mimeType="${mimeType}" isAudio=${isAudio} isPdf=${isPdf}`)

    // Log event shape only in debug mode
    if (!isAudio && process.env.DEBUG_EVENTS === 'true') {
      console.log('[finn] DEBUG event keys:', JSON.stringify(Object.keys(event)))
      console.log('[finn] DEBUG event:', JSON.stringify({ content: event.content, mimeType: event.mimeType, contentType: event.contentType, mediaType: event.mediaType, type: event.type, attachmentType: event.attachmentType, hasMedia: event.hasMedia, filename: event.filename, mimetype: event.mimetype }, null, 2))
    }

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
      } else if (isPdf) {
        const pdfPath = findLatestPdfFile()
        if (!pdfPath) {
          console.error('[finn] pdf: no file found in inbound dir')
          return { handled: true, text: "Não consegui acessar o PDF. Tente enviar novamente." }
        }
        try {
          console.log(`[finn] pdf: processing ${pdfPath}`)
          const pdfBuffer = readFileSync(pdfPath)
          const pdfText = await parsePdf(pdfBuffer)
          console.log(`[finn] pdf: extracted ${pdfText.length} chars`)

          // Route to the right parser based on PDF content
          const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          const fmtDate = (iso: string) => {
            const [, mm, dd] = iso.split('-')
            return `${SHORT_MONTHS[parseInt(mm) - 1]} ${parseInt(dd)}`
          }
          const fmtAmount = (n: number) => `$${n.toFixed(2)}`

          if (pdfText.trim().length < 100) {
            // Image-only PDF (e.g. old scanned statements) — use vision OCR
            console.log('[finn] pdf: image-based PDF detected, using OCR parser')
            const images = pdfToImages(pdfBuffer)
            const invoice = await parseInvoiceOcr(images)
            agentInput = buildInvoiceAgentInput(phone, invoice, await findDuplicates(phone, invoice.items), fmtDate, fmtAmount)

          } else if (/Extrato de:.*Agência|Movimenta[çc][aã]o entre:|Bank Statement:.*Branch|Transactions from:/i.test(pdfText)) {
            // ---------------------------------------------------------------
            // Bradesco bank account statement
            // ---------------------------------------------------------------
            console.log('[finn] pdf: Bradesco bank statement detected')
            const stmt = parseStatementBradesco(pdfText)
            console.log(`[finn] pdf: parsed statement — ${stmt.transactions.length} transactions · ${stmt.periodStart} → ${stmt.periodEnd}`)

            const txs = stmt.transactions
            const incomeTotal     = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
            const expenseTotal    = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
            const cardPayTotal    = txs.filter(t => t.type === 'card_payment').reduce((s, t) => s + t.amount, 0)
            const incomeCount     = txs.filter(t => t.type === 'income').length
            const expenseCount    = txs.filter(t => t.type === 'expense').length
            const cardPayCount    = txs.filter(t => t.type === 'card_payment').length

            // Short date range: "Apr 1–21, 2026"
            const [psy, psm, psd] = stmt.periodStart.split('-')
            const [, pem, ped] = stmt.periodEnd.split('-')
            const dateRange = psm === pem
              ? `${SHORT_MONTHS[parseInt(psm) - 1]} ${parseInt(psd)}–${parseInt(ped)}, ${psy}`
              : `${fmtDate(stmt.periodStart)} – ${fmtDate(stmt.periodEnd)}, ${psy}`

            const header = `🏦 *${stmt.bank}* · ${dateRange} · ${txs.length} transactions`
            const summary = [
              `📈 Income: ${fmtAmount(incomeTotal)} (${incomeCount} items)`,
              `📉 Expenses: ${fmtAmount(expenseTotal)} (${expenseCount} items)`,
              cardPayCount > 0 ? `💳 Card payments: ${fmtAmount(cardPayTotal)} (${cardPayCount} items)` : null,
            ].filter(Boolean).join('\n')

            let rowNum = 0
            const rows = txs.map(tx => {
              rowNum++
              const emoji = tx.type === 'income' ? '📈' : tx.type === 'card_payment' ? '💳' : '📉'
              return `*${rowNum}.* ${emoji} ${fmtDate(tx.date)} · ${tx.description}\n  ${fmtAmount(tx.amount)} · ${tx.category}`
            })

            const formattedTable = [header, '', summary, '', rows.join('\n\n')].join('\n')

            const stmtPayload = JSON.stringify({
              bank: stmt.bank,
              account: stmt.account,
              periodStart: stmt.periodStart,
              periodEnd: stmt.periodEnd,
              openingBalance: stmt.openingBalance,
              transactions: stmt.transactions,
            })

            agentInput = {
              phone,
              message: `[PDF_STATEMENT]\n\nPRE-FORMATTED TABLE — output this VERBATIM to the user, do not summarize or cut:\n${formattedTable}\n\nJSON DATA (use for save_bank_statement):\n${stmtPayload}`,
              mediaType: 'text',
            }

          } else if (/VISA AETERNUM|Fatura Mensal.*Bradesco|Bradesco.*Fatura/i.test(pdfText)) {
            // Bradesco Aeternum credit card invoice
            console.log('[finn] pdf: Bradesco Aeternum detected, using Bradesco invoice parser')
            const invoice = parseInvoiceBradesco(pdfText)
            agentInput = buildInvoiceAgentInput(phone, invoice, await findDuplicates(phone, invoice.items), fmtDate, fmtAmount)

          } else {
            // Default: Itaú / other text-based invoices
            const invoice = parseInvoice(pdfText)
            agentInput = buildInvoiceAgentInput(phone, invoice, await findDuplicates(phone, invoice.items), fmtDate, fmtAmount)
          }
        } catch (pdfErr) {
          console.error('[finn] failed to process PDF:', pdfErr)
          return { handled: true, text: "I couldn't process the invoice PDF. Please try sending it again." }
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
