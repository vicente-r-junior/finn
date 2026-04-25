import type { InvoiceItem, ParsedInvoice } from '../types.js'

// ---- Category suggestion ----

const CATEGORY_RULES: Array<{ patterns: RegExp[]; category: string }> = [
  {
    patterns: [/^AMAZON(?!.*WEB|.*AWS)/i, /^AMZN/i, /^MERCADOLIVRE/i, /^MAGALU/i, /^SHOPEE/i, /^AMERICANAS/i],
    category: 'Shopping',
  },
  {
    patterns: [/^PETLOVE/i, /^PET\s?SHOP/i, /^NACER.*VET/i, /^COBASI/i, /^PETZ/i],
    category: 'Pet',
  },
  {
    patterns: [/^NETFLIX/i, /^SPOTIFY/i, /^DEEZER/i, /^HBO/i, /^DISNEY/i, /^EBN.*CAMBL/i, /^PRIME/i],
    category: 'Streaming',
  },
  {
    patterns: [/^UBER/i, /^99/i, /^LATAM/i, /^GOL/i, /^AZUL/i, /^DECOLAR/i],
    category: 'Transport',
  },
  {
    patterns: [/^AWS/i, /^AMAZON\s*WEB/i, /^DIGITALOCEAN/i, /^GITHUB/i],
    category: 'Technology',
  },
  {
    patterns: [/^IFOOD/i, /^RAPPI/i, /^ZOMATO/i, /^BURGER/i, /^MCDONALD/i, /^KFC/i],
    category: 'Food',
  },
  {
    patterns: [/^FARMAC/i, /^DROGARI/i, /^RAIA/i, /^PANVEL/i, /^ULTRAFARMA/i],
    category: 'Pharmacy',
  },
  {
    patterns: [/^RENNER/i, /^ZARA/i, /^RIACHUELO/i, /^HERING/i, /^AREZZO/i, /^LUIZA/i],
    category: 'Clothing',
  },
  {
    patterns: [/^SARAIVA/i, /^CULTURA/i, /^LIVRARIA/i, /^AMAZON.*BOOK/i, /^TRMF/i, /SUNO/i],
    category: 'Education',
  },
  {
    patterns: [/^CLINICA/i, /^HOSPITAL/i, /^UNIMED/i, /^HAPVIDA/i, /^LABORAL/i],
    category: 'Health',
  },
  {
    patterns: [/^BRASTEMP/i, /^CONSUL/i, /^ELECTROLUX/i],
    category: 'Electronics',
  },
  {
    patterns: [/^PAGAMENTO/i],
    category: 'payment',
  },
  {
    patterns: [/^ENCARGOS/i, /^JUROS/i, /^MULTA/i, /^IOF/i, /^MORA/i],
    category: 'charge',
  },
]

export function suggestCategory(description: string): string | null {
  const upper = description.toUpperCase().trim()
  for (const rule of CATEGORY_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(upper)) {
        return rule.category
      }
    }
  }
  return null
}

// ---- Line parser ----

// Match: optional leading space/dash, then amount in BR format
const AMOUNT_ONLY_RE = /(-\s*[\d.]+,\d{2}|[\d.]+,\d{2})$/

// Match: installment NN/NN + amount glued together or with whitespace, at end of string
const INSTALLMENT_AMOUNT_RE = /(\d{2}\/\d{2})\s*(-?\s*[\d.]+,\d{2})$/

export function parseInvoiceLine(
  line: string
): { date: string; description: string; installment: string | null; amount: number; isPayment: boolean } | null {
  const trimmed = line.trim()

  // Must start with DD/MM
  if (!/^\d{2}\/\d{2}/.test(trimmed)) return null

  // Extract date (first 5 chars)
  const date = trimmed.slice(0, 5)
  const afterDate = trimmed.slice(5)

  let installment: string | null = null
  let rawAmount = ''
  let description = ''

  const instMatch = afterDate.match(INSTALLMENT_AMOUNT_RE)
  if (instMatch) {
    installment = instMatch[1]
    rawAmount = instMatch[2].replace(/\s+/g, '')
    const tail = instMatch[0]
    description = afterDate.slice(0, afterDate.length - tail.length).trim()
  } else {
    const amountMatch = afterDate.match(AMOUNT_ONLY_RE)
    if (!amountMatch) return null
    rawAmount = amountMatch[1].replace(/\s+/g, '')
    description = afterDate.slice(0, afterDate.length - amountMatch[0].length).trim()
  }

  const isPayment = rawAmount.startsWith('-')
  const amountStr = rawAmount.replace('-', '').replace(/\./g, '').replace(',', '.')
  const amount = parseFloat(amountStr)
  if (isNaN(amount)) return null

  // ---- Description cleanup: strip pdftotext -layout column-merge artifacts ----
  //
  // With -layout, Itaú invoices merge the "Próximas faturas" column onto the same
  // line as the current transaction. This leaves garbage like:
  //   "AMAZON MARKETPLACE07/10   52,29   27/05 EBN *CAMBL"
  //                         ^^^^  ^^^^^ standalone amount from other column
  //   "Amazon web services   50,41   IOF de financiamento ..."
  //                          ^^^^^  IOF details from sub-line
  //
  // Strategy: everything from the first "column-separator" (3+ spaces then a BRL amount)
  // onwards is garbage from an adjacent column.

  // 1. Strip: 3+ spaces, then a BRL amount, then everything to end-of-string
  description = description.replace(/\s{3,}[\d.]+,\d{2}\b.*$/s, '').trim()

  // 2. Strip: installment marker (NN/NN) still glued to merchant name after step 1
  //    e.g. "AMAZON MARKETPLACE07/10" → "AMAZON MARKETPLACE"
  description = description.replace(/\d{2}\/\d{2}\s*$/, '').trim()

  return { date, description, installment, amount, isPayment }
}

// ---- Helpers ----

function parseBRDate(ddmm: string, year: number): string {
  const [dd, mm] = ddmm.split('/')
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function parseBRFullDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/')
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function parseBRAmount(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'))
}

function detectCard(text: string): string {
  const upper = text.toUpperCase()
  if (/VISAINFINITE|VISA/.test(upper)) return 'Visa'
  if (/MASTERCARD|MASTER/.test(upper)) return 'Mastercard'
  if (/AETERNUM/.test(upper)) return 'Aeternum'
  return 'Mastercard'
}

function detectCostCenter(holderName: string): 'Me' | 'Lilian' {
  const upper = holderName.toUpperCase()
  if (/LILIANA|LILIAN|GUERRA/.test(upper)) return 'Lilian'
  return 'Me'
}

// ---- Cardholder section extraction ----
// Finds "HOLDERNAME(finalNNNN)LançamentosnocartãoNNNN)X.XXX,XX" in the compressed text
// Returns sections sorted by appearance order in the invoice
function extractCardholderSections(
  text: string
): Array<{ holder: string; costCenter: 'Me' | 'Lilian'; total: number }> {
  // Compress whitespace for easier matching
  const compressed = text.replace(/\s+/g, '')

  const sections: Array<{ holder: string; costCenter: 'Me' | 'Lilian'; total: number; pos: number }> = []

  // Pattern: HOLDERNAME(finalNNNN)Lançamentosnocartão(finalNNNN)AMOUNT
  const re = /([A-ZÁÀÃÂÉÊÍÓÔÕÚÇ]{2,}(?:[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ\s]*[A-ZÁÀÃÂÉÊÍÓÔÕÚÇ])?)\(final(\d{4})\)Lançamentosnocartão\(final\2\)([\d.]+,\d{2})/g

  let m: RegExpExecArray | null
  while ((m = re.exec(compressed)) !== null) {
    const holder = m[1].trim()
    const total = parseBRAmount(m[3])
    sections.push({
      holder,
      costCenter: detectCostCenter(holder),
      total,
      pos: m.index,
    })
  }

  // Sort by position in text (they appear in invoice order)
  sections.sort((a, b) => a.pos - b.pos)

  return sections
}

// ---- Main parser ----

/**
 * Strip credit-limit sidebar content that pdftotext -layout merges onto transaction lines.
 *
 * With -layout, Itaú invoices produce lines like:
 *   "20/03 PETLOVE SAUD*Petl   80,00   Limite total de crédito   74.060,00"
 * The sidebar text (Limite/Disponível blocks) always starts with ≥2 spaces then
 * a Portuguese keyword. We truncate the line at that point so the parser sees
 * only the transaction amount.
 */
function stripInvoiceSidebar(text: string): string {
  // Matches ≥2 spaces followed by known Itaú sidebar keywords (PT-BR only)
  return text.replace(
    /\s{2,}(?:Limite(?:\s+(?:total|m[aá]ximo|de\s+cr[eé]dito|parcelado))|Dispon[ií]vel(?:\s+para)?|Saldo(?:\s+do\s+limite)?|Limite\s+N[aã]o)[^\n]*/gi,
    ''
  )
}

export function parseInvoice(text: string): ParsedInvoice {
  const cleanedText = stripInvoiceSidebar(text)
  const lines = cleanedText.split('\n')

  // --- Metadata ---
  let dueDate = ''
  const dueDateMatch = text.match(/Vencimento[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  if (dueDateMatch) dueDate = parseBRFullDate(dueDateMatch[1])

  let closingDate = ''
  const closingMatch = text.match(/Emiss[aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  if (closingMatch) closingDate = parseBRFullDate(closingMatch[1])

  // "Previsão prox. Fechamento: 18/05/2026" — next cycle closing date
  let nextClosingDate: string | undefined
  const nextClosingMatch = text.match(/Previ[sã]o\s+prox\.?\s+Fechamento[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  if (nextClosingMatch) nextClosingDate = parseBRFullDate(nextClosingMatch[1])

  let cardNumber = ''
  let cardType = ''
  const cardNumMatch = text.match(/(\d{4}\.XXXX\.XXXX\.(\d{4}))(VISA|MASTERCARD|AETERNUM)/i)
  if (cardNumMatch) {
    cardNumber = cardNumMatch[2]
    cardType = detectCard(cardNumMatch[3])
  } else {
    cardType = detectCard(text.slice(0, 500))
  }

  let holderName = ''
  const holderMatch = text.match(/Titular[:\s]+([A-Z\s]+)/i)
  if (holderMatch) holderName = holderMatch[1].trim()

  // --- FIX 1: Extract invoice total from stated amount, not by summing ---
  const compressed = text.replace(/\s+/g, '')
  let totalAmount = 0
  const totalMatch = compressed.match(/Totaldestafatura([\d.]+,\d{2})/)
  if (totalMatch) totalAmount = parseBRAmount(totalMatch[1])

  // "Lançamentos atuais" = total of new charges this cycle (for checksum)
  let currentChargesTotal = 0
  const currentMatch = compressed.match(/Lançamentosatuais([\d.]+,\d{2})/)
  if (currentMatch) currentChargesTotal = parseBRAmount(currentMatch[1])

  // --- Resumo da Fatura fields ---
  // Itaú formula: Saldo financiado + Encargos + Lançamentos atuais = Total desta fatura
  // e.g.: -1.340,84 + 929,60 + 5.193,48 = 4.782,24

  // "Saldo financiado" — negative = credit from overpayment, positive = carried debit balance
  let saldoFinanciado = 0
  const saldoMatch = compressed.match(/Saldofinanciado(-)(R\$)?([\d.]+,\d{2})/)
    ?? compressed.match(/Saldofinanciado()(R\$)?([\d.]+,\d{2})/)
  if (saldoMatch) {
    const sign = saldoMatch[1] === '-' ? -1 : 1
    saldoFinanciado = sign * parseBRAmount(saldoMatch[3])
  }

  // "Encargos (financiamento + moratório)" — interest/penalties on financed balance
  // This is a Resumo line, NOT a transaction item (different from ENCARGOS DE ATRASO in items)
  let encargosFinanciamento = 0
  const encargosMatch = compressed.match(/Encargos\(financiamento\+morat[oó]rio\)([\d.]+,\d{2})/)
    ?? compressed.match(/Encargos\(financiamento\+morat[oó]rio\)-([\d.]+,\d{2})/)
  if (encargosMatch) encargosFinanciamento = parseBRAmount(encargosMatch[1])

  // "Pagamento(s) recebido(s)" — used by some invoice variants instead of Saldo financiado
  let paymentReceived = 0
  const paymentMatch = compressed.match(/Pagamento(?:s)?recebido(?:s)?(-?)(R\$)?([\d.]+,\d{2})/)
  if (paymentMatch) paymentReceived = parseBRAmount(paymentMatch[3])

  // --- Extract international transactions (base + IOF = total billed in BRL) ---
  // Pattern in compressed text: "Totaltransaçõesinter.emR$BASE...TotallançamentosinteremR$TOTAL"
  // Also extract original currency/amount: "9,25USD" or "USD9,25"
  interface IntlTx { base: number; total: number; currency?: string; originalAmount?: number }
  const intlTxs: IntlTx[] = []
  const intlBaseRe = /Totaltransaç[oõ]esinter[^R]*(R\$)?([\d.]+,\d{2})/g
  const intlTotalRe = /Totallançamentosinter[^R]*(R\$)?([\d.]+,\d{2})/g
  // Currency: e.g. "9,25USD9,25" or "USD9,25"
  const intlCurrRe = /([\d.]+,\d{2})(USD|EUR|GBP|ARS|MXN|CLP)|(USD|EUR|GBP|ARS|MXN|CLP)([\d.]+,\d{2})/g

  const intlBases: number[] = []
  const intlTotals: number[] = []
  const intlCurrencies: Array<{ currency: string; amount: number }> = []

  let mx: RegExpExecArray | null
  while ((mx = intlBaseRe.exec(compressed)) !== null) intlBases.push(parseBRAmount(mx[2]))
  while ((mx = intlTotalRe.exec(compressed)) !== null) intlTotals.push(parseBRAmount(mx[2]))
  while ((mx = intlCurrRe.exec(compressed)) !== null) {
    const currency = mx[2] ?? mx[3]
    const amtStr = mx[1] ?? mx[4]
    intlCurrencies.push({ currency, amount: parseBRAmount(amtStr) })
  }

  for (let i = 0; i < Math.min(intlBases.length, intlTotals.length); i++) {
    intlTxs.push({
      base: intlBases[i],
      total: intlTotals[i],
      currency: intlCurrencies[i]?.currency,
      originalAmount: intlCurrencies[i]?.amount,
    })
  }

  // Billing cycle
  const invoiceYear = dueDate ? parseInt(dueDate.slice(0, 4)) : new Date().getFullYear()
  const closingMonth = closingDate ? parseInt(closingDate.slice(5, 7)) : new Date().getMonth() + 1

  let billingCycle = ''
  if (closingDate) {
    billingCycle = closingDate.slice(0, 7)
  } else if (dueDate) {
    const d = new Date(dueDate)
    d.setMonth(d.getMonth() - 1)
    billingCycle = d.toISOString().slice(0, 7)
  }

  // --- FIX 2: Extract per-cardholder section totals for cost_center assignment ---
  // In this Itaú invoice format, the secondary cardholder's section appears FIRST, then the primary's.
  // We track a running total: while running ≤ lilianTotal → 'Lilian', then → 'Me'
  const sections = extractCardholderSections(text)
  const lilianTotal = sections
    .filter(s => s.costCenter === 'Lilian')
    .reduce((sum, s) => sum + s.total, 0)

  // --- Parse all transaction lines (stop at "Próximas faturas" section) ---
  //
  // Itaú invoices have a "Próximas faturas" (future installments) section below
  // the current charges. With pdftotext -layout the two columns can merge onto
  // the same lines, but the section header itself usually appears as its own line.
  // We stop parsing when we hit it to avoid counting future installments.
  const FUTURE_SECTION_RE = /pr[oó]ximas\s+faturas|lan[çc]amentos\s+futuros/i

  const allParsed: Array<{
    date: string; description: string; installment: string | null
    amount: number; isPayment: boolean; lineIdx: number
  }> = []

  for (let i = 0; i < lines.length; i++) {
    if (FUTURE_SECTION_RE.test(lines[i])) break   // everything after this is future charges
    const parsed = parseInvoiceLine(lines[i])
    if (parsed) allParsed.push({ ...parsed, lineIdx: i })
  }

  // --- FIX 3: Deduplicate future installments ---
  // The invoice shows a "próximas faturas" section with NEXT month's installments.
  // Example: installment 11/12 is current → 12/12 is future (skip it).
  // Strategy: group by (date, description, amount, denominator) → keep lowest numerator.
  const installGroups = new Map<string, { idx: number; num: number }>()
  for (let i = 0; i < allParsed.length; i++) {
    const item = allParsed[i]
    if (!item.installment) continue
    const [numStr, denomStr] = item.installment.split('/')
    const num = parseInt(numStr)
    const key = `${item.date}|${item.description}|${item.amount}|${denomStr}`
    const prev = installGroups.get(key)
    if (!prev || num < prev.num) {
      installGroups.set(key, { idx: i, num })
    }
  }
  const keepByInstall = new Set(Array.from(installGroups.values()).map(v => v.idx))

  // Non-installment items: keep ALL occurrences.
  // Single purchases never appear in the future "próximas faturas" section —
  // only installment items repeat there. So no dedup needed for non-installment items.
  const keepNonInstall = new Set<number>()
  for (let i = 0; i < allParsed.length; i++) {
    if (!allParsed[i].installment) keepNonInstall.add(i)
  }

  // --- Build final items with cost_center assignment ---
  const items: InvoiceItem[] = []
  let lilianRunning = 0

  for (let i = 0; i < allParsed.length; i++) {
    const item = allParsed[i]

    // Apply deduplication filter
    if (item.installment) {
      if (!keepByInstall.has(i)) continue
    } else {
      if (!keepNonInstall.has(i)) continue
    }

    const { date, description, installment, amount, isPayment } = item

    // Skip payment lines:
    // 1. Negative amounts (credits applied to account)
    // 2. "PAGAMENTO EFETUADO" = payment of previous invoice — user explicitly excludes this
    if (isPayment) continue
    if (/^PAGAMENTO\s+EFETUADO/i.test(description)) continue

    const txMonth = parseInt(date.slice(3, 5))
    const txYear = txMonth > closingMonth ? invoiceYear - 1 : invoiceYear
    const isoDate = parseBRDate(date, txYear)

    const category = suggestCategory(description)
    const isCharge =
      category === 'charge' ||
      /^(ENCARGOS|JUROS|MULTA|IOF|MORA)/i.test(description)

    // FIX 2 (cont.): Assign cost_center using threshold approach
    // Lilian's items appear first in the invoice; once running total exceeds lilianTotal → 'Me'
    let costCenter: 'Me' | 'Lilian'
    if (lilianTotal > 0 && !isCharge) {
      lilianRunning += amount
      costCenter = lilianRunning <= lilianTotal + 0.10 ? 'Lilian' : 'Me'
    } else {
      costCenter = detectCostCenter(holderName)
    }

    items.push({
      date,
      isoDate,
      description,
      installment,
      amount,
      isPayment: false,
      isCharge,
      isInternational: false,
      originalCurrency: undefined,
      originalAmount: undefined,
      category: isCharge ? 'charge' : category,
      cost_center: costCenter,
      card: cardType,
      cardHolder: holderName,
      due_date: dueDate,
      billing_cycle: billingCycle,
    })
  }

  // --- Add Resumo da Fatura synthetic items ---
  // These ensure sum(amount) in the DB equals the invoice total (what actually leaves the bank).
  // Formula: Lançamentos atuais + Encargos + Saldo financiado = Total desta fatura
  //   e.g.:    5.193,48          + 929,60  + (-1.340,84)      = 4.782,24
  //
  // cost_center: split proportionally between Me and Lilian.
  // These are account-level adjustments — each person bears a share proportional to
  // their spending this cycle.  We generate TWO rows per Resumo item (one per person)
  // so that sum(amount) still equals the invoice total after splitting.
  //
  // dueDateDDMM: "25/04" from "2026-04-25"
  const dueDateDDMM = dueDate ? `${dueDate.slice(8, 10)}/${dueDate.slice(5, 7)}` : ''

  // Resumo items always belong to the primary account holder (Me).
  // Only individual transaction items (Lançamentos) are split with Lilian.
  const resumoBase = {
    date:             dueDateDDMM,
    isoDate:          dueDate,
    installment:      null,
    isPayment:        false,
    isInternational:  false,
    originalCurrency: undefined as string | undefined,
    originalAmount:   undefined as number | undefined,
    cost_center:      'Me' as const,
    card:             cardType,
    cardHolder:       holderName,
    due_date:         dueDate,
    billing_cycle:    billingCycle,
  }

  if (encargosFinanciamento > 0) {
    items.push({
      ...resumoBase,
      description: 'Encargos (financiamento + moratório)',
      amount:      encargosFinanciamento,
      isCharge:    true,
      category:    'charge',
    })
  }

  if (saldoFinanciado !== 0) {
    items.push({
      ...resumoBase,
      description: saldoFinanciado < 0 ? 'Saldo financiado (crédito anterior)' : 'Saldo financiado anterior',
      amount:      saldoFinanciado,   // negative for credits — intentional
      isCharge:    saldoFinanciado > 0,
      category:    saldoFinanciado < 0 ? 'Credit' : 'charge',
    })
  }

  // --- Post-process: update international items with IOF-adjusted amounts ---
  // intlTxs[i].base = raw BRL amount on the transaction line
  // intlTxs[i].total = base + IOF (what actually gets billed)
  for (const intlTx of intlTxs) {
    // Find first unmatched item whose amount equals this transaction's base amount
    const match = items.find(item => !item.isInternational && Math.abs(item.amount - intlTx.base) < 0.005)
    if (match) {
      match.amount = intlTx.total
      match.isInternational = true
      if (intlTx.currency) match.originalCurrency = intlTx.currency
      if (intlTx.originalAmount) match.originalAmount = intlTx.originalAmount
    }
  }

  return {
    card: cardType,
    cardNumber,
    holderName,
    dueDate,
    billingCycle,
    closingDate,
    totalAmount,
    currentChargesTotal,
    saldoFinanciado,
    encargosFinanciamento,
    paymentReceived,
    nextClosingDate,
    items,
  }
}
