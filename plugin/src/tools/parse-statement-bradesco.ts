/**
 * parse-statement-bradesco.ts
 *
 * Parses Bradesco bank account statement PDF text.
 * Supports both Portuguese (real Bradesco exports) and English (demo/test files).
 *
 * PDF format — Portuguese (Bradesco Mobile export):
 *   Header:   "Extrato de: Agência: 2329 | Conta: 289142-5 | Movimentação entre: 01/04/2026 e 21/04/2026"
 *   Columns:  "DataHistóricoDocto.Crédito (R$)Débito (R$)Saldo (R$)"
 *   Opening:  "31/03/2026COD. LANC. 00,0018.234,06"
 *   Tx types: GASTOS CARTAO DE CREDITO, RENTAB.INVEST FACILCRED, TRANSFERENCIA PIX,
 *             PIX QR CODE, PAGTO ELETRON COBRANCA, BX.ANT.FINANC/EMP
 *   Skip:     TRANSF SALDO C/SAL P/CC
 *
 * PDF format — English (demo/test files):
 *   Header:   "Bank Statement: Branch: 1234 | Account: 567890-1 | Transactions from: 04/01/2026 to 04/23/2026"
 *   Columns:  "DateDescriptionRef.Credit ($)Debit ($)Balance ($)"
 *   Opening:  "03/31/2026OPENING BALANCE 00,005.000,00"
 *   Tx types: CREDIT CARD PAYMENT, INVESTMENT YIELD, BANK TRANSFER,
 *             QR PAYMENT, BILL PAYMENT, LOAN PAYMENT
 *   Skip:     INTERNAL TRANSFER
 *
 * Key insight: the balance is always the LAST BRL-format amount on a data line.
 * Transaction amount = |balance - prev_balance| — more reliable than parsing
 * the credit/debit column because pdf-parse often glues docto digits to amounts.
 */

import type { BankTransaction, ParsedStatement } from '../types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBRDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/')
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

/**
 * Extract all properly-formatted BRL amounts from a string.
 * Format: 1–3 digits, then optional groups of .NNN (thousands), then ,NN (cents).
 * Using strict format prevents matching glued docto+amount strings as one amount.
 */
const AMOUNT_PATTERN = /\d{1,3}(?:\.\d{3})*,\d{2}/g

interface AmountMatch {
  value: number
  index: number
  text: string
}

function extractAmounts(s: string): AmountMatch[] {
  const re = new RegExp(AMOUNT_PATTERN.source, 'g')
  const results: AmountMatch[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    results.push({
      value: parseFloat(m[0].replace(/\./g, '').replace(',', '.')),
      index: m.index,
      text: m[0],
    })
  }
  return results
}

/**
 * Extract description prefix from a data line — the text that appears before
 * the docto (digit-only prefix that precedes the first amount).
 */
function extractDescPrefix(line: string, firstAmtIndex: number): string {
  let pos = firstAmtIndex
  while (pos > 0 && /\d/.test(line[pos - 1])) pos--
  return line.slice(0, pos).replace(/[\s\-\*]+$/, '').trim()
}

/**
 * Build a clean description from accumulated description lines + any prefix
 * found on the data line itself. Handles beneficiary "DES: NAME DD/MM" pattern.
 */
function buildDescription(descLines: string[], dataLinePrefix: string): string {
  const parts = [...descLines.map(l => l.trim()), dataLinePrefix].filter(Boolean)
  let desc = parts.join(' ').replace(/\s+/g, ' ').trim()

  // "TRANSFERENCIA PIX DES: FULANO 01/04" → "TRANSFERENCIA PIX - FULANO"
  desc = desc.replace(/\s+DES:\s*/i, ' - ')
  // Strip trailing "DD/MM" date suffix added by bank (e.g. " 01/04")
  desc = desc.replace(/\s+\d{2}\/\d{2}$/, '').trim()
  // Strip BCO/AGE/CTA internals (shouldn't appear, but just in case)
  desc = desc.replace(/\s+BCO:\d+.*$/i, '').trim()

  return desc
}

// ---------------------------------------------------------------------------
// Type + category mapping
// ---------------------------------------------------------------------------

function mapTransaction(
  desc: string,
  isCredit: boolean,
): { type: BankTransaction['type']; category: string } {
  const u = desc.toUpperCase()

  // ── Credit card bill payment ──────────────────────────────────────────────
  if (/GASTOS CARTAO DE CREDITO|CREDIT CARD PAYMENT/.test(u))
    return { type: 'card_payment', category: 'Card Payment' }

  // ── Investment income ─────────────────────────────────────────────────────
  if (/RENTAB\.INVEST|RENDIMENTO|APLICACAO AUTO|INVESTMENT YIELD/.test(u))
    return { type: 'income', category: 'Investment' }

  // ── Loan installment ──────────────────────────────────────────────────────
  if (/BX\.ANT\.FINANC|EMPRESTIMO|FINANCIAMENTO|LOAN PAYMENT|LOAN INSTALLMENT/.test(u))
    return { type: 'expense', category: 'Loan' }

  // ── Scheduled bill payment ────────────────────────────────────────────────
  if (/PAGTO ELETRON|PAGAMENTO ELETRON|DEB AUT|BILL PAYMENT/.test(u))
    return { type: 'expense', category: 'Bills' }

  // ── QR code / mobile payment ──────────────────────────────────────────────
  if (/PIX QR CODE|QR PAYMENT/.test(u))
    return { type: 'expense', category: 'Others' }

  // ── Bank transfer (direction from saldo change) ───────────────────────────
  if (/TRANSFERENCIA PIX|TRANSF\.? PIX|TED|BANK TRANSFER|WIRE TRANSFER/.test(u))
    return isCredit
      ? { type: 'income', category: 'Transfer' }
      : { type: 'expense', category: 'Transfer' }

  return isCredit
    ? { type: 'income', category: 'Others' }
    : { type: 'expense', category: 'Others' }
}

// ---------------------------------------------------------------------------
// Line classifiers
// ---------------------------------------------------------------------------

const PAGE_HEADER_RE =
  /^(Bradesco (Celular|Bank|Mobile)|Data:\s*\d|Date:\s*\d|Nome:|Name:|Extrato de:|Bank Statement:|Folha:|Sheet:|DataHist|DateDesc)/i
const DATE_FULL_RE = /^(\d{2}\/\d{2}\/\d{4})$/
const DATE_PREFIX_RE = /^(\d{2}\/\d{2}\/\d{4})(.*)/
const SKIP_DESC_RE = /TRANSF SALDO C\/SAL P\/CC|INTERNAL TRANSFER/i
const OPENING_RE = /COD\. LANC\.|OPENING BALANCE/i

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseStatementBradesco(text: string): ParsedStatement {
  // --- Header (Portuguese or English) ---
  const accountMatch = text.match(
    /Extrato de:\s*(Agência:\s*\d+\s*\|\s*Conta:\s*[\d\-]+)/ // PT
  ) ?? text.match(
    /Bank Statement:\s*(Branch:\s*\d+\s*\|\s*Account:\s*[\d\-]+)/ // EN
  )
  const account = accountMatch ? accountMatch[1].trim() : ''

  const periodMatch = text.match(
    /Movimenta[çc][aã]o entre:\s*(\d{2}\/\d{2}\/\d{4})\s*e\s*(\d{2}\/\d{2}\/\d{4})/ // PT
  ) ?? text.match(
    /Transactions from:\s*(\d{2}\/\d{2}\/\d{4})\s*to\s*(\d{2}\/\d{2}\/\d{4})/ // EN
  )
  const periodStart = periodMatch ? parseBRDate(periodMatch[1]) : ''
  const periodEnd   = periodMatch ? parseBRDate(periodMatch[2]) : ''

  // --- Line-by-line parsing ---
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean)

  let openingBalance = 0
  let openingFound   = false
  let prevSaldo      = 0
  let currentDate    = ''
  let descLines: string[] = []
  const transactions: BankTransaction[] = []

  for (const rawLine of rawLines) {
    // Skip page / column headers
    if (PAGE_HEADER_RE.test(rawLine)) { descLines = []; continue }
    // Skip summary total line ("TotalXXX,XX…")
    if (/^Total\d/.test(rawLine)) { descLines = []; continue }

    // Handle lines that start with a full DD/MM/YYYY date
    let processLine = rawLine
    const dateMatch = processLine.match(DATE_PREFIX_RE)
    if (dateMatch) {
      currentDate  = parseBRDate(dateMatch[1])
      processLine  = dateMatch[2].trim()
      descLines    = []                     // new day resets description accumulator
      if (!processLine) continue            // date-only line
    }

    // -----------------------------------------------------------------------
    // Check for BRL amounts → data line
    // -----------------------------------------------------------------------
    const amounts = extractAmounts(processLine)

    if (amounts.length >= 1) {
      // Saldo is always the last amount on the line
      const saldo       = amounts[amounts.length - 1].value
      const firstAmt    = amounts[0]
      const descPrefix  = extractDescPrefix(processLine, firstAmt.index)
      const fullDesc    = buildDescription(descLines, descPrefix)
      descLines         = []

      // --- Skip rules (before advancing prevSaldo for lines with no transaction context) ---
      // Only advance prevSaldo for lines that represent real balance changes:
      // actual transactions (kept) and known-skip internal transfers (still move the balance).
      // Lines with no description or no date are malformed/continuation lines — do NOT advance.
      if (!fullDesc || !currentDate) continue

      const oldSaldo = prevSaldo
      prevSaldo      = saldo   // advance for real transaction lines + known skips below

      if (SKIP_DESC_RE.test(fullDesc)) continue   // internal own-account transfer (balance still moved)

      if (OPENING_RE.test(fullDesc)) {
        if (!openingFound) {
          openingBalance = saldo
          openingFound   = true
        }
        continue
      }

      // --- Compute amount from saldo change ---
      const txAmt    = Math.round(Math.abs(saldo - oldSaldo) * 100) / 100
      const isCredit = saldo > oldSaldo

      if (txAmt < 0.01) continue   // zero-change lines (e.g. duplicate page rows)

      const { type, category } = mapTransaction(fullDesc, isCredit)
      const billing_cycle = currentDate.slice(0, 7)

      transactions.push({
        date:           currentDate,
        description:    fullDesc,
        amount:         txAmt,
        type,
        category,
        card:           'Bradesco',
        due_date:       currentDate,
        billing_cycle,
      })
    } else {
      // Description / continuation line
      if (processLine) descLines.push(processLine)
    }
  }

  // De-duplicate: "Últimos Lançamentos" page may repeat the last day of the main period.
  // Remove any transaction with identical (date + description + amount).
  const seen = new Set<string>()
  const deduped = transactions.filter(tx => {
    const key = `${tx.date}|${tx.description}|${tx.amount}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { bank: 'Bradesco', account, periodStart, periodEnd, openingBalance, transactions: deduped }
}
