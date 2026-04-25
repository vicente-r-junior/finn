/**
 * parse-invoice-bradesco.ts
 *
 * Parses Bradesco Visa Aeternum "Fatura Mensal" PDF text.
 *
 * Key differences from Itaú:
 * - Columns: Data | Histórico | Cidade | US$ | Cotação do Dólar | R$
 * - IOF lines appear globally at top (not per-transaction) — skip them
 * - PAGTO. POR DEB EM C/C = payment — skip
 * - SALDO ANTERIOR = previous balance — skip
 * - Cardholder sections: "HOLDERNAME\nCartão 4271 XXXX XXXX NNNN"
 * - card 1601 → secondary cardholder, all others → primary cardholder
 * - No installment fields natively but some descriptions embed "NN/NN"
 * - International: USD column present, R$ column is final billed amount (IOF already included)
 * - "Total para X" subtotal lines
 * - "Total da fatura em real X" = invoice total
 * - "Previsão de fechamento da próxima fatura: DD/MM/YYYY" = nextClosingDate
 */

import type { InvoiceItem, ParsedInvoice } from '../types.js'
import { suggestCategory } from './parse-invoice.js'

function parseBRAmount(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'))
}

function parseBRFullDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/')
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

/**
 * Given a DD/MM date string and invoice context (due date year/month),
 * infer the full YYYY-MM-DD. Transactions are in the cycle month (dueMonth - 1).
 */
function inferIsoDate(ddmm: string, cycleYear: number, cycleMonth: number): string {
  const [dd, mm] = ddmm.split('/').map(Number)
  // The cycle month is the expected month. If the parsed month is wildly different
  // (e.g. "26/07" among March items) it's a typo — clamp to cycleMonth.
  let month = mm
  let year = cycleYear
  if (Math.abs(month - cycleMonth) > 2) {
    // Looks like a typo/OCR artifact — use cycle month
    month = cycleMonth
  }
  // Handle year boundary (e.g. Dec cycle, Jan items)
  if (month > cycleMonth + 2) year--
  if (month < cycleMonth - 2) year = cycleYear
  return `${year}-${String(month).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

const IOF_RE = /^(CUSTO TRANS\.?\s*EXTERIOR|IOF S\/|CUSTO TRANS EXTERIOR)/i
const PAYMENT_RE = /^PAGTO\.?\s*POR DEB|^SALDO ANTERIOR/i
const CHARGE_RE = /^ENCARGOS|^JUROS|^MULTA|^MORA|^ANUIDADE|^SEGURO SUPER|^CUSTO TRANS|^IOF S\//i

export function parseInvoiceBradesco(text: string): ParsedInvoice {
  const compressed = text.replace(/\s+/g, ' ')

  // --- Header ---
  const dueDateMatch = text.match(/Vencimento\s+(\d{2}\/\d{2}\/\d{4})/)
  const dueDate = dueDateMatch ? parseBRFullDate(dueDateMatch[1]) : ''

  const nextClosingMatch = text.match(/Previs[aã]o de fechamento da pr[oó]xima fatura[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  const nextClosingDate = nextClosingMatch ? parseBRFullDate(nextClosingMatch[1]) : undefined

  const totalMatch = compressed.match(/Total da fatura em real\s*([\d.]+,\d{2})/)
  const totalAmount = totalMatch ? parseBRAmount(totalMatch[1]) : 0

  // Billing cycle = month before due date
  let billingCycle = ''
  const cycleYear = dueDate ? parseInt(dueDate.slice(0, 4)) : new Date().getFullYear()
  let cycleMonth = dueDate ? parseInt(dueDate.slice(5, 7)) - 1 : new Date().getMonth()
  if (cycleMonth === 0) { cycleMonth = 12 }
  if (dueDate) {
    const d = new Date(dueDate)
    d.setMonth(d.getMonth() - 1)
    billingCycle = d.toISOString().slice(0, 7)
  }

  const effectiveCycleYear = cycleMonth === 12 ? cycleYear - 1 : cycleYear

  // --- Parse transactions section ---
  // Find "Lançamentos" section
  const lancIdx = text.indexOf('Lançamentos')
  if (lancIdx === -1) {
    return {
      card: 'Aeternum', cardNumber: '', holderName: '', dueDate, billingCycle,
      closingDate: '', totalAmount, currentChargesTotal: totalAmount,
      saldoFinanciado: 0, encargosFinanciamento: 0, paymentReceived: 0,
      nextClosingDate, items: [],
    }
  }

  const txSection = text.slice(lancIdx)

  // --- Block-based parsing ---
  // pdf-parse wraps long lines across multiple lines. We group all lines belonging
  // to one transaction into a "block" (starts with DD/MM), then extract from the block.
  // Section headers reset the current cardholder context but are NOT transaction blocks.

  const SECTION_RE = /^(Cart[aã]o\s+4271|Total para|Lançamentos|Data\s+Histórico|Número do Cartão|Total da fatura|Mensagem|Página)/i
  const DATE_START_RE = /^(\d{2}\/\d{2})\s+/

  const rawLines = txSection.split('\n').map(l => l.trim()).filter(Boolean)

  // Group into blocks: each block is [ dateLine, ...continuationLines ]
  type Block = { header: boolean; lines: string[] }
  const blocks: Block[] = []
  for (const line of rawLines) {
    if (SECTION_RE.test(line) || /^[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]{3,}(\s+[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]+)*$/.test(line)) {
      // Section header or all-caps name line → own block, flagged
      blocks.push({ header: true, lines: [line] })
    } else if (DATE_START_RE.test(line)) {
      // New transaction starts
      blocks.push({ header: false, lines: [line] })
    } else if (blocks.length > 0) {
      // Continuation line — append to last block
      blocks[blocks.length - 1].lines.push(line)
    }
  }

  let currentCostCenter: 'Me' | 'Lilian' = 'Me'
  let currentCardHolder = ''
  let holderName = ''
  const items: InvoiceItem[] = []

  const CITIES_RE = /(SAO PAULO|SANTOS|BARUERI|FLORIANOPOLIS|FLORIANOPOL|RIO DE JANEIRO|CAMPINAS|CURITIBA|BELO HORIZONTE|MORUMBI|ANTHROPIC\.C?O?M?)\s*$/i
  const AMOUNT_RE = /([\d.]+,\d{2})$/

  for (const block of blocks) {
    const full = block.lines.join('')  // join all lines of this block into one string

    // Handle section headers
    if (block.header) {
      const cartaoMatch = full.match(/Cart[aã]o\s+4271\s+XXXX\s+XXXX\s+(\d{4})/)
      if (cartaoMatch) {
        const last4 = cartaoMatch[1]
        currentCostCenter = last4 === '1601' ? 'Lilian' : 'Me'
        // Cardholder name comes from the preceding all-caps name block
        const prevBlock = blocks[blocks.indexOf(block) - 1]
        if (prevBlock?.header) {
          currentCardHolder = prevBlock.lines[0]
          if (!holderName && currentCostCenter === 'Me') holderName = currentCardHolder
        }
      }
      continue
    }

    // Extract date and rest from the joined block
    const dateMatch = full.match(/^(\d{2}\/\d{2})\s+(.+)/)
    if (!dateMatch) continue

    const ddmm = dateMatch[1]
    let rest = dateMatch[2]

    const isPayment = PAYMENT_RE.test(rest)
    if (isPayment) continue  // skip PAGTO and SALDO ANTERIOR only

    // --- Extract amount ---
    // International: "DESCRIPTIONUSDxx,xxMERCHANTxx,xxN,NNNNBRL" → exchange rate has 4 decimals
    const isInternational = /USD[\d.,]+/i.test(rest)
    let originalCurrency: string | undefined
    let originalAmount: number | undefined
    let amount = 0
    let descRaw = ''

    if (isInternational) {
      // Exchange rate pattern: \d+,\d{4} → BRL amount immediately follows
      const intlMatch = rest.match(/\d+,\d{4}([\d.]+,\d{2})/)
      if (intlMatch) {
        amount = parseBRAmount(intlMatch[1])
      } else {
        const fallback = rest.match(AMOUNT_RE)
        amount = fallback ? parseBRAmount(fallback[1]) : 0
      }
      originalCurrency = 'USD'
      const usdMatch = rest.match(/USD([\d.,]+)/i)
      if (usdMatch) originalAmount = parseBRAmount(usdMatch[1])
      descRaw = rest.replace(/USD.*$/, '').trim()
    } else {
      // Domestic: amount is the last \d+,\d{2} in the joined block
      // But: some blocks have "110,00ANTHROPIC.COM110,00" — we want the LAST one
      // And: "ANUIDADE DIFERENCIADA160,0012/12" — "12/12" is NOT an amount, take 160,00
      // Strategy: find all 2-decimal numbers, take the last one that isn't part of "NN/NN"
      const amounts = [...rest.matchAll(/([\d.]+,\d{2})(?!\/\d{2})/g)]
      if (amounts.length > 0) {
        const lastAmt = amounts[amounts.length - 1]
        amount = parseBRAmount(lastAmt[1])
        // Description = everything before the last amount
        descRaw = rest.slice(0, rest.lastIndexOf(lastAmt[0])).trim()
      } else if (!isPayment) {
        continue
      }
    }

    // Clean description
    descRaw = descRaw.replace(CITIES_RE, '').trim()
    descRaw = descRaw.replace(/\d+,\d{4}.*$/, '').trim()  // strip exchange rate junk
    // Strip embedded amounts that got glued to description (e.g. "SUBSCRIPTION110,00", "ANTHROPIC100,00")
    descRaw = descRaw.replace(/[\d.]+,\d{2}.*$/, '').trim()

    // Extract installment (NN/NN where denominator 2–60)
    let installment: string | null = null
    const instMatch = descRaw.match(/(\d{2}\/\d{2})\s*$/)
    if (instMatch) {
      const [num, den] = instMatch[1].split('/').map(Number)
      if (den >= 2 && den <= 60 && num >= 1 && num <= den) {
        installment = instMatch[1]
        descRaw = descRaw.slice(0, descRaw.lastIndexOf(instMatch[1])).trim()
      }
    }

    // Final cleanup
    descRaw = descRaw.replace(CITIES_RE, '').trim()
    const description = descRaw.replace(/\s+/g, ' ').trim()
    if (!description) continue

    const isCharge = !isPayment && CHARGE_RE.test(description)
    const isoDate = inferIsoDate(ddmm, effectiveCycleYear, cycleMonth)

    items.push({
      date: ddmm,
      isoDate,
      description,
      installment,
      amount,
      isPayment,
      isCharge,
      isInternational,
      originalCurrency,
      originalAmount,
      category: isCharge ? 'charge' : (suggestCategory(description) ?? null),
      cost_center: currentCostCenter,
      card: 'Aeternum',
      cardHolder: currentCardHolder,
      due_date: dueDate,
      billing_cycle: billingCycle,
    })
  }

  const itemsSum = items.filter(i => !i.isPayment).reduce((s, i) => s + i.amount, 0)
  const currentChargesTotal = Math.round(itemsSum * 100) / 100

  return {
    card: 'Aeternum',
    cardNumber: '2609',
    holderName,
    dueDate,
    billingCycle,
    closingDate: '',
    totalAmount: totalAmount || currentChargesTotal,
    currentChargesTotal,
    saldoFinanciado: 0, encargosFinanciamento: 0,
    paymentReceived: 0,
    nextClosingDate,
    items,
  }
}
