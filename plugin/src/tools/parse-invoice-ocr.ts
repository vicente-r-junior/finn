/**
 * parseInvoiceOcr — for image-based PDFs (e.g. Bradesco Aeternum)
 *
 * Sends each page as a JPEG to GPT-4.1 vision and asks it to extract
 * structured invoice data directly as JSON. This avoids a fragile
 * regex-based parser for a format we don't control.
 *
 * IOF lines are folded into the preceding international transaction.
 * SALDO ANTERIOR and PAGTO lines are excluded.
 */

import OpenAI from 'openai'
import type { ParsedInvoice, InvoiceItem } from '../types.js'
import { suggestCategory } from './parse-invoice.js'

const EXTRACTION_PROMPT = `
You are parsing a Brazilian Bradesco Visa Aeternum credit card invoice (Fatura Mensal), 2 pages.

STEP 1 — Extract header fields:
- "Total da fatura" box → totalAmount (e.g. R$ 1.828,80 → 1828.80)
- "Vencimento" box → dueDate (DD/MM/YYYY → YYYY-MM-DD)
- "Previsão de fechamento da próxima fatura" → nextClosingDate (DD/MM/YYYY → YYYY-MM-DD)

STEP 2 — Extract transactions from page 2 "Lançamentos" table.
The table has columns: Data | Histórico | Cidade | US$ | Cotação do Dólar | R$
The AMOUNT to use is ALWAYS the LAST column (R$). Never use the US$ or Cotação columns as amount.

INCLUDE/EXCLUDE rules:
- EXCLUDE: "PAGTO. POR DEB EM C/C" → isPayment:true
- EXCLUDE: "SALDO ANTERIOR" → isPayment:true
- EXCLUDE ENTIRELY (do not include at all): any IOF line ("CUSTO TRANS. EXTERIOR-IOF", "IOF S/ TRANS INTER REAIS", "CUSTO TRANS EXTERIOR")
- INCLUDE: "ANUIDADE DIFERENCIADA" → isCharge:true
- INCLUDE: "SEGURO SUPERPROTEGIDO" → isCharge:true (it's a recurring insurance fee)
- INCLUDE: all other purchase lines

DESCRIPTION cleaning:
- Strip trailing city names (SAO PAULO, SANTOS, BARUERI, etc.) from descriptions
- For installments like "GOL LINHAS ADBOBAG6301/03SAO PAULO": description="GOL LINHAS ADBOBAG63", installment="01/03"
- For "DECOLAR             01/03BARUERI": description="DECOLAR", installment="01/03"

INTERNATIONAL transactions (US$ column > 0):
- isInternational: true
- originalCurrency: "USD"
- originalAmount: the US$ value
- amount: the R$ value (last column) — e.g. for "AMAZON PRIME*AN22Y0853 | 14,99 | 5,4400 | 79,30" → amount=79.30, originalAmount=14.99

CARDHOLDER sections — each section starts with "Cartão 4271 XXXX XXXX NNNN":
- card 2609 or 7346 → cardHolder: "JOHN DOE", cost_center will be set by system
- card 1601 → cardHolder: "JANE DOE", cost_center will be set by system

DATES: format is DD/MM, infer year from invoice context.
A date like "26/07" appearing among March items is a typo — use "26/03" instead.

Return ONLY valid JSON (no markdown, no explanation):
{
  "card": "Aeternum",
  "cardNumber": "2609",
  "holderName": "JOHN DOE",
  "dueDate": "YYYY-MM-DD",
  "closingDate": null,
  "nextClosingDate": "YYYY-MM-DD",
  "totalAmount": 1828.80,
  "currentChargesTotal": 1828.80,
  "items": [
    {
      "isoDate": "YYYY-MM-DD",
      "description": "MERCHANT NAME",
      "installment": null,
      "amount": 0.00,
      "isPayment": false,
      "isCharge": false,
      "isInternational": false,
      "originalCurrency": null,
      "originalAmount": null,
      "cardHolder": "FULL NAME"
    }
  ]
}
`.trim()

interface OcrInvoiceJson {
  card: string
  cardNumber: string
  holderName: string
  dueDate: string | null
  closingDate: string | null
  nextClosingDate: string | null
  totalAmount: number
  currentChargesTotal: number
  items: Array<{
    isoDate: string
    description: string
    installment: string | null
    amount: number
    isPayment: boolean
    isCharge: boolean
    isInternational: boolean
    originalCurrency: string | null
    originalAmount: number | null
    cardHolder: string
  }>
}

export async function parseInvoiceOcr(imageBuffers: Buffer[]): Promise<ParsedInvoice> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '' })

  const imageContent = imageBuffers.map(buf => ({
    type: 'image_url' as const,
    image_url: {
      url: `data:image/jpeg;base64,${buf.toString('base64')}`,
      detail: 'high' as const,
    },
  }))

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: EXTRACTION_PROMPT },
        ...imageContent,
      ],
    }],
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  })

  const raw = response.choices[0]?.message?.content ?? '{}'
  const data = JSON.parse(raw) as OcrInvoiceJson

  // Hard override: this parser is only used for Aeternum (Bradesco image PDFs)
  const card = 'Aeternum'

  // Build billing cycle from dueDate
  let billingCycle = ''
  if (data.dueDate) {
    const d = new Date(data.dueDate)
    d.setMonth(d.getMonth() - 1)
    billingCycle = d.toISOString().slice(0, 7)
  } else if (data.items.length > 0) {
    const dates = data.items
      .filter(i => !i.isPayment)
      .map(i => i.isoDate)
      .sort()
      .reverse()
    if (dates[0]) billingCycle = dates[0].slice(0, 7)
  }

  const items: InvoiceItem[] = data.items
    // Hard-filter any IOF lines GPT may have included despite instructions
    .filter(i => !/IOF|CUSTO TRANS/i.test(i.description) || i.isPayment)
    .map(i => {
      const isCharge = i.isCharge
        || /^ENCARGOS|^JUROS|^MULTA|^MORA|^ANUIDADE|^SEGURO SUPER/i.test(i.description)
      const suggestedCat = isCharge ? null : suggestCategory(i.description)

      return {
        date: i.isoDate.slice(5).replace('-', '/'),
        isoDate: i.isoDate,
        description: i.description,
        installment: i.installment ?? null,
        amount: i.amount,
        isPayment: i.isPayment,
        isCharge,
        isInternational: i.isInternational,
        originalCurrency: i.originalCurrency ?? undefined,
        originalAmount: i.originalAmount ?? undefined,
        category: isCharge ? 'charge' : (suggestedCat ?? null),
        cost_center: /lilian|souza/i.test(i.cardHolder) ? 'Lilian' : 'Me',
        card,
        cardHolder: i.cardHolder,
        due_date: data.dueDate ?? '',
        billing_cycle: billingCycle,
      }
    })

  // If GPT returned 0 for totalAmount, fall back to summing items
  const totalAmount = (data.totalAmount && data.totalAmount > 0)
    ? data.totalAmount
    : items.filter(i => !i.isPayment).reduce((s, i) => s + i.amount, 0)

  return {
    card,
    cardNumber: data.cardNumber ?? '',
    holderName: data.holderName ?? '',
    dueDate: data.dueDate ?? '',
    billingCycle,
    closingDate: data.closingDate ?? '',
    totalAmount,
    currentChargesTotal: data.currentChargesTotal ?? totalAmount,
    saldoFinanciado: 0, encargosFinanciamento: 0,
    paymentReceived: 0,
    nextClosingDate: data.nextClosingDate ?? undefined,
    items,
  }
}
