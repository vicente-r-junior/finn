# Finn 💰 — Personal Finance Assistant for WhatsApp

> Log expenses, import credit card invoices, and query your spending — all from a WhatsApp chat.

Finn is an [OpenClaw](https://openclaw.dev) plugin that turns WhatsApp into a personal finance interface. No app to install. No dashboard to remember. Just send a message.

```
You:  spent 45 on lunch
Finn: $45 · Food · Mastercard · Me · 2026-04-22 — confirm? ✅
You:  sim
Finn: ✅ Saved!
```

---

## Features

| Feature | How it works |
|---------|-------------|
| **Log expenses** | Type or voice-note any purchase |
| **Smart defaults** | Card = Mastercard, cost center = Me, date = today — never asks unless ambiguous |
| **Multi-language** | Responds in PT-BR or English based on your last message |
| **Audio notes** | Voice messages transcribed by Whisper, processed as text |
| **Credit card PDF import** | Send the invoice PDF → itemized review → one-tap save |
| **Bank statement import** | Bradesco statement PDFs parsed and saved automatically |
| **Spending queries** | "How much on Transport?" pulls across all sources (cards + bank + manual) |
| **Vocabulary learning** | Learns your shortcuts: "roxinho" → Nu, "feira" → Supermarket |
| **Duplicate detection** | Warns before saving a possible duplicate |
| **Phone whitelist** | Only your number gets responses |

---

## Architecture

```
WhatsApp
    │
    ▼
OpenClaw Gateway
    │  before_dispatch hook
    ▼
Finn Plugin (TypeScript)
    │
    ├─ Text/Audio → runAgent()
    │      └─ gpt-4.1 tool-use loop → Supabase
    │
    └─ PDF ──────────────────────────────────────┐
           ├─ Credit card invoice                │
           │   ├─ Text-based → parseInvoice()    │
           │   └─ Image-based → parseInvoiceOcr()│
           └─ Bank statement                     │
               └─ parseStatementBradesco()        │
                        (saldo-diff algorithm)    │
                                                  ▼
                                             Supabase
                                          (transactions table)
```

### Tool-Use Loop

The agent runs a maximum of 5 iterations against gpt-4.1. Tools available:

| Tool | Purpose |
|------|---------|
| `save_transaction` | Persist confirmed expense / income / card payment |
| `query_spending` | Query totals and breakdowns from the database |
| `save_bulk_transactions` | Bulk-save invoice items from a PDF import |
| `save_bank_statement` | Bulk-save bank statement rows |
| `update_transaction` | Edit a saved record (with confirmation) |
| `delete_transaction` | Delete a saved record (with confirmation) |

All mutations require explicit user confirmation before the tool is called.

### Supabase Schema

```sql
-- migrations/001_init.sql
CREATE TABLE transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text NOT NULL,
  type         text NOT NULL CHECK (type IN ('expense','income','card_payment')),
  amount       numeric NOT NULL,
  description  text,
  category     text,
  cost_center  text NOT NULL CHECK (cost_center IN ('Me','Lilian')),
  card         text,            -- null = Cash/PIX
  date         date NOT NULL,
  due_date     date,            -- credit card billing due date
  billing_cycle text,           -- YYYY-MM
  source       text,            -- text | audio | pdf | image
  raw_input    text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
```

> **Customise `cost_center`:** The two cost centers (`Me` and `Lilian`) are personal — replace them with what makes sense for your setup in `types.ts`, `agent.ts` (tool schema), and `prompts.ts`.

---

## PDF Parsing

### Credit Card Invoices

Supports text-based PDFs (most modern invoices) and image-based/scanned PDFs (vision OCR via gpt-4o). Parsers available:

- `parse-invoice.ts` — generic parser (Itaú Visa)
- `parse-invoice-bradesco.ts` — Bradesco Aeternum format
- `parse-invoice-ocr.ts` — fallback vision OCR

### Bank Statements — Saldo-Diff Algorithm

Standard PDF parsers fail on bank statements because document reference numbers get concatenated with transaction amounts:

```
PAGTO ELETRON COBRANCA 00000401.603,27165.730,05
                       ↑ docto ↑  ↑ misleading ↑
```

Naively parsing this reads $401,603.27 instead of the correct $1,603.27.

**The fix:** the running account balance (`saldo`) is always the _last_ BRL-formatted number on the line and is always clean. Compute the transaction amount from the balance change:

```typescript
const saldo   = amounts[amounts.length - 1].value
const txAmount = Math.abs(saldo - prevSaldo)
const isCredit = saldo > prevSaldo
```

This is reliable regardless of what the credit/debit columns contain.

---

## Setup

### Prerequisites

- [OpenClaw](https://openclaw.dev) installed and running with a WhatsApp connector
- Node.js 20+
- A [Supabase](https://supabase.com) project
- OpenAI API key

### 1. Clone and install

```bash
git clone https://github.com/your-username/finn
cd finn/plugin
npm install
```

### 2. Create the database schema

Run the migrations in order against your Supabase project:

```bash
# Using Supabase CLI
supabase db push --file migrations/001_init.sql
supabase db push --file migrations/002_add_banks.sql

# Or paste directly into the Supabase SQL editor
```

### 3. Configure environment variables

Create `plugin/.env`:

```env
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...

# Comma-separated list of allowed WhatsApp numbers (with country code)
# Leave empty to allow all numbers (not recommended for production)
ALLOWED_PHONES=+5511999990000

# Set to "true" to log raw event payloads (useful for debugging new connectors)
DEBUG_EVENTS=false
```

### 4. Build and deploy

```bash
npm run build
```

**Via the included deploy script** (edit `deploy.sh` first to set your VPS IP):

```bash
# deploy.sh — set YOUR_VPS_IP before running
./deploy.sh
```

**Manual deploy:**

```bash
# Copy the built plugin to OpenClaw's extensions directory
rsync -avz plugin/dist/ root@YOUR_VPS_IP:/root/.openclaw/extensions/finance-agent/dist/
ssh root@YOUR_VPS_IP 'pm2 restart finn'
```

### 5. Register with OpenClaw

Place `openclaw/` in the OpenClaw hooks directory and ensure `openclaw.plugin.json` is present:

```json
{
  "name": "finance-agent",
  "version": "1.0.0",
  "hooks": ["before_dispatch"]
}
```

---

## Usage

### Logging expenses

```
spent 90 on pharmacy
paid Netflix 55.90 on nubank
almoço 35 ontem
```

### Income

```
received salary 8000
freelance payment 1500 yesterday
```

### Queries

```
how much did I spend this month?
quanto gastei em alimentação?
break down my expenses by category
what's my total on Transport?
```

### PDF invoice

Send the PDF directly via WhatsApp. Finn will:
1. Parse and display all items with categories
2. Ask about any unknown categories
3. Warn about duplicates from previous imports
4. Save after your confirmation

### Voice notes

Send a voice message. Finn transcribes via Whisper and processes it like text.

---

## Cost Centers

Out of the box, Finn tracks two cost centers: **Me** and **Lilian** (representing two people sharing finances). To customise:

1. `plugin/src/types.ts` — update the `CostCenter` type
2. `plugin/src/agent.ts` — update the tool schema enum
3. `plugin/src/prompts.ts` — update the Cost Centers section
4. `plugin/src/index.ts` — update the display name mapping (`item.cost_center === 'Lilian' ? 'Lilian' : 'YourName'`)

---

## Development

```bash
cd plugin
npm run dev        # watch mode
npm test           # run all tests (Jest)
npm run build      # compile to dist/
```

Tests are in `plugin/tests/` and `plugin/src/__tests__/`.

---

## Spending Queries: 60-Day Rolling Window

The `period: 'month'` query uses a **60-day rolling window** instead of the calendar month start. This is intentional: credit card purchases are typically made 30–45 days before the invoice due date.

Example: a Transport purchase made on March 8 appears on the April invoice (due April 10). A calendar-month filter `>= April 1` would miss it. The 60-day window captures it correctly.

---

## Security

- **Gateway-level:** OpenClaw's `allowFrom` whitelist blocks unknown senders before the plugin fires
- **Application-level:** `ALLOWED_PHONES` env var provides a secondary whitelist in the plugin
- **Database-level:** all queries are scoped by `phone`; `update` and `delete` operations include a `phone` equality guard in addition to the record ID
- **Supabase RLS:** enable Row Level Security on the `transactions` table and scope policies to the `phone` column for full isolation

---

## License

MIT — see [LICENSE](LICENSE).

---

## Acknowledgements

Built with [OpenClaw](https://openclaw.dev), [OpenAI](https://openai.com), and [Supabase](https://supabase.com).
