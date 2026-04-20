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
    patterns: [/^RENNER/i, /^ZARA/i, /^RIACHUELO/i, /^HERING/i, /^AREZZO/i],
    category: 'Clothing',
  },
  {
    patterns: [/^SARAIVA/i, /^CULTURA/i, /^LIVRARIA/i, /^AMAZON.*BOOK/i],
    category: 'Books',
  },
  {
    patterns: [/^CLINICA/i, /^HOSPITAL/i, /^UNIMED/i, /^HAPVIDA/i, /^LABORAL/i],
    category: 'Health',
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

// Matches the full trailing portion: optional installment (DD/DD) + amount
// The installment and amount may or may not be separated by spaces.
// Amount: optional negative sign + optional spaces + digits with BR formatting ending in ,NN
//
// Examples:
//   "07/1052,29"       → installment=07/10, amount=52,29
//   "03/0399,16"       → installment=03/03, amount=99,16
//   "01/03842,34"      → installment=01/03, amount=842,34
//   " 07/10152,08"     → installment=07/10, amount=152,08
//   "- 1.340,84"       → no installment, isPayment=true
//   "44,90"            → no installment, amount=44,90
//   "50,41"            → no installment, amount=50,41
//
// Strategy: greedily try to match `NN/NN` + amount at the end.
// The key insight: an installment is always NN/NN followed IMMEDIATELY by the amount digits.
// So we look for the pattern: (NN/NN)(digits,NN) at the tail after stripping the date.

// Match: optional leading space/dash, then amount in BR format
const AMOUNT_ONLY_RE = /(-\s*[\d.]+,\d{2}|[\d.]+,\d{2})$/

// Match: installment NN/NN + amount glued together or with whitespace, at end of string
// The installment NN/NN must come immediately before digits (not a comma), then the amount
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

  // Try to match installment + amount at the end
  let installment: string | null = null
  let rawAmount = ''
  let description = ''

  const instMatch = afterDate.match(INSTALLMENT_AMOUNT_RE)
  if (instMatch) {
    installment = instMatch[1]
    rawAmount = instMatch[2].replace(/\s+/g, '')
    // description is everything before the installment
    const tail = instMatch[0]
    description = afterDate.slice(0, afterDate.length - tail.length).trim()
  } else {
    // No installment — just extract amount from end
    const amountMatch = afterDate.match(AMOUNT_ONLY_RE)
    if (!amountMatch) return null
    rawAmount = amountMatch[1].replace(/\s+/g, '')
    description = afterDate.slice(0, afterDate.length - amountMatch[0].length).trim()
  }

  const isPayment = rawAmount.startsWith('-')
  const amountStr = rawAmount.replace('-', '').replace(/\./g, '').replace(',', '.')
  const amount = parseFloat(amountStr)
  if (isNaN(amount)) return null

  return { date, description, installment, amount, isPayment }
}

// ---- Date helpers ----

function parseBRDate(ddmm: string, year: number): string {
  const [dd, mm] = ddmm.split('/')
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function parseBRFullDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/')
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// ---- Card detection ----

function detectCard(text: string): string {
  const upper = text.toUpperCase()
  if (/VISAINFINITE|VISA/.test(upper)) return 'Visa'
  if (/MASTERCARD|MASTER/.test(upper)) return 'Mastercard'
  if (/AETERNUM/.test(upper)) return 'Aeternum'
  return 'Mastercard'
}

// ---- Cost center ----

function detectCostCenter(holderName: string): 'Me' | 'Lilian' {
  const upper = holderName.toUpperCase()
  if (/LILIANA|LILIAN|GUERRA/.test(upper)) return 'Lilian'
  return 'Me'
}

// ---- Main parser ----

export function parseInvoice(text: string): ParsedInvoice {
  const lines = text.split('\n')

  // Extract due date: "Vencimento: DD/MM/YYYY"
  let dueDate = ''
  const dueDateMatch = text.match(/Vencimento[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  if (dueDateMatch) {
    dueDate = parseBRFullDate(dueDateMatch[1])
  }

  // Extract closing/emission date: "Emissão: DD/MM/YYYY"
  let closingDate = ''
  const closingMatch = text.match(/Emiss[aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i)
  if (closingMatch) {
    closingDate = parseBRFullDate(closingMatch[1])
  }

  // Extract card number and card type
  let cardNumber = ''
  let cardType = ''
  const cardNumMatch = text.match(/(\d{4}\.XXXX\.XXXX\.(\d{4}))(VISA|MASTERCARD|AETERNUM)/i)
  if (cardNumMatch) {
    cardNumber = cardNumMatch[2]
    cardType = detectCard(cardNumMatch[3])
  } else {
    cardType = detectCard(text.slice(0, 500))
  }

  // Extract holder name — look for a line after the card number block
  // Typically appears as an all-caps name line near the card
  let holderName = ''
  const holderMatch = text.match(/Titular[:\s]+([A-Z\s]+)/i)
  if (holderMatch) {
    holderName = holderMatch[1].trim()
  } else {
    // Try to find a capitalized name near the card number area
    const nameMatch = text.match(/\d{4}\.XXXX\.XXXX\.\d{4}[A-Z]+\s*\n([A-Z][A-Z\s]+)/)
    if (nameMatch) {
      holderName = nameMatch[1].trim()
    }
  }

  const costCenter = detectCostCenter(holderName)

  // Infer invoice year and closing month for isoDate calculation
  const invoiceYear = dueDate ? parseInt(dueDate.slice(0, 4)) : new Date().getFullYear()
  const closingMonth = closingDate ? parseInt(closingDate.slice(5, 7)) : new Date().getMonth() + 1

  // Billing cycle from closing date (or due date minus 1 month as fallback)
  let billingCycle = ''
  if (closingDate) {
    billingCycle = closingDate.slice(0, 7) // YYYY-MM
  } else if (dueDate) {
    const d = new Date(dueDate)
    d.setMonth(d.getMonth() - 1)
    billingCycle = d.toISOString().slice(0, 7)
  }

  // Parse transaction lines
  const items: InvoiceItem[] = []
  let totalAmount = 0

  for (const line of lines) {
    const parsed = parseInvoiceLine(line)
    if (!parsed) continue

    const { date, description, installment, amount, isPayment } = parsed

    // Determine isoDate year: if transaction month > closing month, it's from previous year
    const txMonth = parseInt(date.slice(3, 5))
    const txYear = txMonth > closingMonth ? invoiceYear - 1 : invoiceYear
    const isoDate = parseBRDate(date, txYear)

    const category = suggestCategory(description)
    const isCharge =
      category === 'charge' ||
      /^(ENCARGOS|JUROS|MULTA|IOF|MORA)/i.test(description)

    if (!isPayment && !isCharge) {
      totalAmount += amount
    }

    items.push({
      date,
      isoDate,
      description,
      installment,
      amount,
      isPayment,
      isCharge,
      category: isPayment ? 'payment' : isCharge ? 'charge' : category,
      cost_center: costCenter,
      card: cardType,
      cardHolder: holderName,
      due_date: dueDate,
      billing_cycle: billingCycle,
    })
  }

  return {
    card: cardType,
    cardNumber,
    holderName,
    dueDate,
    billingCycle,
    closingDate,
    totalAmount: Math.round(totalAmount * 100) / 100,
    items,
  }
}
