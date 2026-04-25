---
title: "Finn 💰 — A Personal Finance Assistant That Lives in WhatsApp"
published: true
tags: devchallenge, openclawchallenge
cover_image: https://dev-to-uploads.s3.amazonaws.com/uploads/articles/placeholder_cover.png
---

*This is a submission for the [OpenClaw Challenge](https://dev.to/challenges/openclaw-2026-04-16).*

---

## What I Built

**Finn** is a personal finance assistant that lives entirely in WhatsApp. No app to install, no dashboard to remember to open — you just message Finn the way you'd message a friend.

> "spent 90 on pharmacy"
> "→ $90 · Pharmacy · Mastercard · Me · 2026-04-22 — confirm? ✅"

Say "sim" and it's saved. Ask "how much did I spend on food this month?" and Finn queries the database and replies instantly.

The problem Finn solves is a real one: most personal finance tools require you to change your habits (log into an app, categorize manually, remember later). Finn fits into a habit you already have — checking WhatsApp.

**What it can do:**

- 📝 **Log expenses and income** via text or voice note (Whisper transcription)
- 📄 **Parse credit card PDF invoices** (Aeternum/Bradesco, Itaú Visa) — send the PDF, review the itemized list, confirm, saved
- 🏦 **Parse bank account statement PDFs** (Bradesco) — transactions extracted via a saldo-diff algorithm that works around garbled PDF text
- 🔍 **Query spending** — by period, category, card, or cost center (cross-source: credit cards + bank account + manual entries combined)
- 🎯 **Learn your vocabulary** — if you always call "almoço" → Food, Finn learns and maps silently
- 🔒 **Phone whitelist** — only your number gets a response

---

## How I Used OpenClaw

The entire agent is an OpenClaw plugin registered as a `before_dispatch` hook. Here's the architecture:

```
WhatsApp → OpenClaw gateway → before_dispatch hook → Finn plugin → OpenAI gpt-4.1 → Supabase
```

### The Plugin Registration

```typescript
// plugin/openclaw.plugin.json
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
    return { handled: true, text: '' } // silent ignore
  }

  // Route: audio → Whisper, PDF → parser, text → agent
  const result = await runAgent({ phone, message, mediaType })
  return { handled: true, text: result.reply }
})
```

### The Agent Loop

The core of Finn is a tool-use loop over `gpt-4.1` with six tools:

| Tool | Purpose |
|------|---------|
| `save_transaction` | Persist a confirmed expense/income/card payment |
| `query_spending` | Query totals, breakdowns, history from Supabase |
| `save_bulk_transactions` | Bulk-save confirmed invoice items from PDF |
| `save_bank_statement` | Bulk-save confirmed bank statement rows |
| `update_transaction` | Edit a saved record after confirmation |
| `delete_transaction` | Delete a record after confirmation |

**State machine enforced by the system prompt:** the LLM never calls `save_transaction` without user confirmation. The confirmation message always uses a canonical format:

```
$45 · Food · Mastercard · Me · 2026-04-22 — confirm? ✅
```

### PDF Invoice Pipeline

When a PDF arrives, the plugin routes it before it ever reaches the LLM:

```typescript
if (pdfText.trim().length < 100) {
  // Image-based PDF (scanned) → vision OCR
  const invoice = await parseInvoiceOcr(pdfToImages(pdfBuffer))
} else if (/Extrato de:.*Agência/i.test(pdfText)) {
  // Bank statement
  const stmt = parseStatementBradesco(pdfText)
} else {
  // Credit card invoice (text-based)
  const invoice = await parseInvoice(pdfText)
}
```

For bank statements, I developed a **saldo-diff algorithm** because `pdf-parse` garbles the credit/debit columns — docto numbers get concatenated with amounts. Example from a real PDF:

```
PAGTO ELETRON COBRANCA 00000401.603,27165.730,05
```

Parsing the column directly would read `401.603,27` ($401,603.27!). But the running balance (`saldo`) at the end of the line is always clean — and that's where the truth lives. So instead:

```typescript
const saldo = amounts[amounts.length - 1].value  // always reliable
const txAmount = Math.abs(saldo - prevSaldo)       // the actual debit
const isCredit = saldo > prevSaldo                 // direction from balance movement
```

This produced 43 correct transactions from a real Bradesco statement, including a $1,828.80 card payment that exactly matched the Aeternum credit card invoice imported separately. ✅

### Spending Queries: The Period Mismatch Problem

There was a subtle bug: asking "how much on Transport this month?" returned zero, even though Transport transactions existed.

The cause: I had a March 8 Aeternum credit card purchase with `date: 2026-03-08`, but the `period: 'month'` query was filtering `date >= 2026-04-01`. The purchase existed in the DB — it just fell before the calendar month start.

The fix: credit card purchases are made 30-45 days before the invoice due date. "This month's spending" should cover that lag:

```typescript
if (period === 'month') {
  // 60-day rolling window — covers credit card purchases made last billing cycle
  const from = new Date(now)
  from.setDate(from.getDate() - 60)
  return { from: from.toISOString().split('T')[0], to }
}
```

And to prevent the LLM from answering from conversation context instead of the database, I force `query_spending` as the first tool call for any spending question:

```typescript
const SPENDING_Q_RE = /how much|quanto (gastei|ganhei|paguei|saiu|vence|entrou)|breakdown|gastos/i
let toolChoice = SPENDING_Q_RE.test(userText)
  ? { type: 'function', function: { name: 'query_spending' } }
  : 'auto'
```

---

## Demo

### Logging an expense

```
Me:   spent 45 on lunch at the food court
Finn: $45 · Food · Mastercard · Me · 2026-04-22 — confirm? ✅
Me:   sim
Finn: ✅ Saved! Anything else?
```

### Voice note

```
Me:   🎙️ [voice note: "pharmacy, eighty reais, nubank"]
Finn: 🎙️ "pharmacy, eighty reais, nubank"

      $80 · Pharmacy · Nu · Me · 2026-04-22 — confirm? ✅
Me:   yes
Finn: ✅ Saved!
```

### PDF Invoice Import

```
Me:   [sends Aeternum credit card invoice PDF]
Finn: 📄 Aeternum · Due Apr 25, 2026 · $4,832.19 · 28 items (26 new · 2 skipped)

      1. ✅ Amazon
         Apr 1 · $89.90 · Shopping · Me

      2. ✅ Netflix
         Apr 2 · $55.90 · Entertainment · Me

      3. ❓ MP*CBRDOC
         Apr 5 · $69.98 · ❓ · Me
      ...

      ❓ What category for: #3 MP*CBRDOC ($69.98)?

Me:   Documents
Finn: Updated. Save 26 items? (2 duplicates will be skipped)
Me:   yes
Finn: ✅ Saved 26 transactions · Total $4,762.31
      Shopping: $890.40 · Food: $423.80 · Entertainment: $211.70...
```

### Spending Query (cross-source)

```
Me:   how much did I spend on Transport this month?
Finn: 🚗 Transport — last 60 days
      $487.20 across 8 transactions

      Mar 8  · Uber           $34.90 (Aeternum)
      Mar 12 · Parking        $22.00 (Bradesco)
      Mar 15 · Shell gas      $180.00 (Nu)
      ...
```

---

## What I Learned

**1. PDF parsing is harder than it looks.** The text extraction from `pdf-parse` is reliable for prose but unreliable for table columns — numbers get concatenated with adjacent document reference codes. The saldo-diff approach was a counterintuitive fix: instead of parsing the value I want, compute it from context.

**2. "This month" is not a calendar concept.** For a credit card user, "this month's spending" naturally includes purchases from 4-6 weeks ago that appear on the current invoice. The mismatch between calendar-month filtering and credit card billing cycles caused a real bug that was invisible in unit tests.

**3. Forcing tool calls prevents LLM hallucination from context.** Even with a well-crafted system prompt saying "always call query_spending," the model would sometimes answer "you spent $X on Transport" by inferring from a recently-parsed PDF still in context — instead of querying the database. Forcing `tool_choice` on the first iteration is a reliable fix.

**4. WhatsApp as an interface has real advantages.** The friction of logging expenses is the #1 reason personal finance apps fail. If the interface is something people check 50 times a day anyway, the logging habit forms naturally.

**5. Security is about layers.** OpenClaw's `allowFrom` whitelist blocks at the gateway level. The `ALLOWED_PHONES` env var adds an application-level check. Database rows are scoped by `phone` with RLS. Each layer is independent — if one fails, the others still protect.

---

## ClawCon Michigan

I didn't attend ClawCon Michigan — I'm based in Brazil! But building Finn was my version of the same energy: picking up a new framework and immediately building something real with it.

---

## Tech Stack

- **Runtime:** TypeScript, Node.js 20, pm2 on a VPS
- **Framework:** OpenClaw (plugin with `before_dispatch` hook)
- **LLM:** OpenAI gpt-4.1 (tool use loop)
- **Database:** Supabase (PostgreSQL) with Row Level Security
- **PDF parsing:** `pdf-parse` + custom text parsers
- **Audio:** OpenAI Whisper (via `openai` SDK)
- **Channel:** WhatsApp (via OpenClaw's WhatsApp connector)

**GitHub:** [github.com/your-username/finn](https://github.com/your-username/finn) *(replace with your actual repo)*
