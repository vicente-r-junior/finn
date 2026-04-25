---
title: "Finn 💰 — A Personal Finance Assistant That Lives in WhatsApp"
published: true
tags: devchallenge, openclawchallenge
---

*This is a submission for the [OpenClaw Challenge](https://dev.to/challenges/openclaw-2026-04-16).*

---

## What I Built

**Finn** is a personal finance assistant that lives entirely in WhatsApp. No app to install, no dashboard to remember to open — you just message Finn the way you'd message a friend.

The problem Finn solves is a real one: most personal finance tools require you to change your habits (log into an app, categorize manually, remember later). Finn fits into a habit you already have — checking WhatsApp.

**What it can do:**

- 📝 **Log expenses and income** via text or voice note (Whisper transcription)
- 📄 **Parse credit card PDF invoices** — send the PDF, review the itemized list, confirm, saved
- 🏦 **Parse bank account statement PDFs** — transactions extracted via a saldo-diff algorithm that works around garbled PDF text
- 🔍 **Query spending** — by period, category, card, or cost center (cross-source: credit cards + bank account + manual entries combined)
- ✏️ **Edit or delete** any saved record by just describing it
- 🔒 **Phone whitelist** — only your number gets a response

---

## Demo

All four scenarios below are real conversations with a running Finn instance.

---

### 🟢 Demo 1 — Log a Single Expense

The most common interaction: user mentions an amount and a description. Finn classifies the category and card automatically, shows a confirmation line, and only saves after approval.

```
You:   189 on lunch
Finn:  $189 · Food · Mastercard · Me · 2026-04-22 — confirm? ✅

You:   yeah
Finn:  ✅ Saved! Anything else?
```

If the description is ambiguous, Finn asks exactly one clarifying question:

```
You:   spent 80 today
Finn:  What was it for?

You:   pharmacy
Finn:  $80 · Pharmacy · Mastercard · Me · 2026-04-22 — confirm? ✅

You:   yes
Finn:  ✅ Saved!
```

Voice notes work the same way — Finn echoes the transcription before acting:

```
You:   🎙️ [audio: "spent ninety at the grocery store today"]
Finn:  🎙️ _"spent ninety at the grocery store today"_

       $90 · Groceries · Mastercard · Me · 2026-04-22 — confirm? ✅

You:   yes
Finn:  ✅ Saved!
```

---

### ✏️ Demo 2 — Change Something

You can correct any saved record in plain language. Finn finds the most recent matching transaction, shows what will change, and waits for confirmation.

**Change the amount:**

```
You:   the pharmacy one was actually 95, not 80
Finn:  Update $80 → $95 · Pharmacy · Mastercard · Me · 2026-04-22 — confirm? ✅

You:   yes
Finn:  ✅ Updated!
```

**Change the category:**

```
You:   that lunch from yesterday, mark it as Entertainment
Finn:  Update Food → Entertainment · $189 · Mastercard · Me · 2026-04-22 — confirm? ✅

You:   yes
Finn:  ✅ Updated!
```

**Delete a record:**

```
You:   delete the $90 grocery entry
Finn:  Delete $90 · Groceries · Mastercard · Me · 2026-04-22 — are you sure? 🗑️

You:   yes
Finn:  ✅ Deleted.
```

---

### 📄 Demo 3 — Import a Credit Card PDF Invoice

You forward the invoice PDF to the WhatsApp chat. Finn parses it, shows you every line, resolves unknown categories, and bulk-saves on one "yes".

```
You:   [sends Mastercard invoice PDF]

Finn:  📄 Mastercard · Due 2026-04-10 · $2,340.00 · 18 items (16 new · 2 skipped)

       📊 Invoice Summary
       Purchases: $2,680.00 · Financed balance (credit): -$520.00 · Interest: +$180.00 · Total due: $2,340.00

       1. ✅ UBER*TRIP
          Mar 12 · $18.50 · Transport · Me

       2. ✅ NETFLIX.COM
          Mar 13 · $15.99 · Entertainment · Me

       3. ✅ AMAZON PRIME
          Mar 14 · $42.30 · Shopping · Me (intl · USD 7.99)

       4. ❓ SQ*DOWNTOWN MKT
          Mar 15 · $34.00 · ❓ · Me

       5. ✅ SHELL GAS STATION
          Mar 17 · $95.00 · Transport · Me

       6. ✅ DELTA AIRLINES 01/03
          Mar 19 · $320.00 · Travel · Me
       ...

       ❓ What category for: #4 SQ*DOWNTOWN MKT ($34.00)?

You:   Groceries

Finn:  Got it. Save all 16 items? (2 duplicates will be skipped)

You:   yes

Finn:  ✅ Saved 16 transactions · Total $2,340.00
       Transport: $210.50 · Shopping: $380.00 · Food: $195.00 · Entertainment: $95.99 · Travel: $320.00 · Other: $1,138.51
```

The "Invoice Summary" line reconciles the invoice math: `Purchases + Interest + Financed balance = Total due`. Finn stores the interest and financed balance as signed rows so `SELECT SUM(amount)` always equals the invoice total.

For image-based (scanned) PDFs, Finn automatically falls back to GPT-4.1 Vision OCR — same output, no extra steps for the user.

---

### 🔍 Demo 4 — Query Spending

Finn always queries the database — it never answers from memory or inference.

**Total this month:**

```
You:   how much did I spend this month?
Finn:  📊 All spending — last 60 days
       Total: $6,234.18

       Shopping:     $1,402.10
       Food:           $534.90
       Transport:      $487.20
       Entertainment:  $211.70
       Travel:         $420.00
       Other:        $3,178.28
```

**By category:**

```
You:   breakdown of Transport
Finn:  🚗 Transport — last 60 days
       $487.20 across 8 transactions

       Mar 15 · Uber              $34.90  (Mastercard)
       Mar 20 · Posto Ipiranga   $180.00  (Mastercard)
       Apr 01 · Uber              $28.50  (Mastercard)
       Apr 05 · Shell Gas        $155.00  (Nu)
       Apr 10 · Parking           $22.00  (Bradesco)
       ...
```

**Cross-source (credit card + bank account):**

```
You:   did my card payment hit the bank account?
Finn:  Yes — Mar 31 bank debit of $4,782.24 matches your Mastercard invoice exactly. ✅
```

**A specific period:**

```
You:   how much did I spend on Food in March?
Finn:  🍽️ Food — March 2026
       $312.40 across 9 transactions

       Highest: $89.90 at a restaurant on Mar 22
       Daily average: $10.08
```

---

## How I Used OpenClaw

The entire agent is an OpenClaw plugin registered as a `before_dispatch` hook. Every WhatsApp message — text, voice, or PDF — passes through Finn before OpenClaw does anything else.

```
WhatsApp → OpenClaw gateway → before_dispatch hook → Finn plugin → OpenAI gpt-4.1 → Supabase
```

### Plugin Registration

```typescript
// openclaw.plugin.json
{
  "name": "finance-agent",
  "version": "1.0.0",
  "hooks": ["before_dispatch"]
}
```

```typescript
// plugin/src/index.ts
api.on('before_dispatch', async (event, ctx) => {
  const phone = ctx.senderId ?? event.senderId

  // Phone whitelist — only the owner gets responses
  const allowedPhones = process.env.ALLOWED_PHONES?.split(',').map(p => p.trim()) ?? []
  if (allowedPhones.length > 0 && !allowedPhones.includes(phone)) {
    return { handled: true, text: '' }  // silent ignore for unknown numbers
  }

  const result = await runAgent({ phone, message, mediaType })
  return { handled: true, text: result.reply }
})
```

### The Agent Loop

The core is a tool-use loop over `gpt-4.1` with six tools and a maximum of 5 iterations:

| Tool | Purpose |
|------|---------|
| `save_transaction` | Persist a confirmed expense or income entry |
| `query_spending` | Query totals, breakdowns, history from Supabase |
| `save_bulk_transactions` | Bulk-save confirmed invoice items from a PDF |
| `save_bank_statement` | Bulk-save confirmed bank statement rows |
| `update_transaction` | Edit a saved record after confirmation |
| `delete_transaction` | Delete a record after confirmation |

The system prompt enforces a strict state machine: the LLM never calls `save_transaction` without an explicit user confirmation. The confirmation always uses a canonical format:

```
$45 · Food · Mastercard · Me · 2026-04-22 — confirm? ✅
```

### Preventing LLM Hallucination on Queries

Even with a well-crafted prompt saying "always call query_spending", the model would sometimes answer "you spent $X on Transport" by inferring from a recently-parsed PDF in context — instead of querying the database. The fix: force `tool_choice` on the first iteration for any spending question:

```typescript
const SPENDING_Q_RE = /how much|breakdown|what did I spend/i
let toolChoice = SPENDING_Q_RE.test(userText)
  ? { type: 'function', function: { name: 'query_spending' } }
  : 'auto'
```

### PDF Invoice Pipeline

When a PDF arrives, the plugin routes it before the LLM ever sees it:

```typescript
if (pdfText.trim().length < 100) {
  // Scanned/image-based PDF → GPT-4.1 Vision OCR
  invoice = await parseInvoiceOcr(pdfToImages(pdfBuffer))
} else if (/Extrato de:.*Agência/i.test(pdfText)) {
  // Bank statement
  stmt = parseStatementBradesco(pdfText)
} else {
  // Text-based credit card invoice
  invoice = parseInvoice(pdfText)
}
```

### The Saldo-Diff Algorithm (Bank Statements)

Bank statement PDFs garble the credit/debit columns — document reference numbers get concatenated with amounts. A real example:

```
ELECTRONIC PAYMENT REF 00000087.240,00312.490,55
```

Parsing the column directly would read `$87,240.00`. The running balance at the end of each line is always clean, so instead of parsing the column value, I compute it from context:

```typescript
const saldo = amounts[amounts.length - 1].value  // always reliable
const txAmount = Math.abs(saldo - prevSaldo)       // the actual transaction amount
const isCredit = saldo > prevSaldo                 // direction from balance movement
```

This produced 38 correct transactions from a real bank statement, including a card payment that exactly matched the credit card invoice imported separately. ✅

### Invoice Math Reconciliation

Itaú Mastercard invoices include a "Resumo da Fatura" table with this formula:

```
Lançamentos atuais + Encargos (interest) + Saldo financiado (financed balance) = Total da fatura
```

Finn parses all three fields and stores interest and financed balance as signed rows in the database. This means `SELECT SUM(amount) FROM transactions WHERE card = 'Mastercard'` always returns the exact invoice total — not just the purchases subtotal.

---

## What I Learned

**1. PDF parsing is harder than it looks.** The text extraction from `pdf-parse` is reliable for prose but unreliable for table columns — numbers get concatenated with adjacent reference codes. The saldo-diff approach was a counterintuitive fix: instead of parsing the value I want, compute it from context.

**2. "This month" is not a calendar concept for credit cards.** A purchase on March 8 appears on an April invoice — so a filter of `date >= April 1` would miss it. Finn uses a 60-day rolling window for "this month" queries to cover the billing cycle lag.

**3. Forcing `tool_choice` prevents silent hallucination.** The model reliably answers from database queries when forced, and sometimes "just knows" from context when not forced. Both answers look correct — the second one just isn't queryable later.

**4. WhatsApp as an interface has a real adoption advantage.** The friction of opening a dedicated finance app is the #1 reason people stop using them. A chat interface that's already open all day has zero switching cost.

**5. Security in layers.** OpenClaw's `allowFrom` whitelist blocks at the gateway level. `ALLOWED_PHONES` adds an application-level check. Supabase rows are scoped by `phone` with RLS. Each layer is independent — if one fails, the others still hold.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Channel | WhatsApp via OpenClaw |
| Runtime | TypeScript, Node.js 20 |
| Framework | OpenClaw (`before_dispatch` hook) |
| LLM | OpenAI gpt-4.1 (tool-use loop) |
| Database | Supabase (PostgreSQL + Row Level Security) |
| PDF parsing | `pdf-parse` + custom text parsers |
| Vision OCR | GPT-4.1 Vision (scanned PDFs) |
| Audio | OpenAI Whisper |
| Deployment | pm2 on a VPS |

**GitHub:** [github.com/vicente-r-junior/finn](https://github.com/vicente-r-junior/finn)
