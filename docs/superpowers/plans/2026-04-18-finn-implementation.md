# Finn Finance Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Finn — an OpenClaw-native WhatsApp finance agent that logs expenses/income via text, audio, image and PDF, confirms before saving, queries spending, and learns the user's personal vocabulary over time.

**Architecture:** OpenClaw Gateway (Node.js, PM2, VPS) handles WhatsApp via Baileys. A TypeScript plugin (`finance-agent`) registered with OpenClaw provides one tool (`finance_agent`) that runs a full OpenAI tool-use conversation loop, manages state per phone in Supabase (`finn` schema), and processes media via Whisper + gpt-4.1-mini vision.

**Tech Stack:** Node.js 24, OpenClaw, TypeScript 5, OpenAI SDK (`openai`), Supabase JS (`@supabase/supabase-js`), pdf-parse, Vitest, PM2, nginx, certbot.

---

## File Map

```
/Users/vicentejr/dev/finn/
├── migrations/
│   └── 001_init.sql               — all finn.* tables + seed data
├── openclaw/
│   ├── SOUL.md                    — Finn's personality
│   ├── AGENTS.md                  — route all messages to finance_agent tool
│   └── IDENTITY.md                — name, emoji, vibe
└── plugin/
    ├── package.json
    ├── tsconfig.json
    ├── manifest.json              — OpenClaw plugin manifest
    ├── src/
    │   ├── index.ts               — plugin entry, registers finance_agent tool
    │   ├── types.ts               — all shared TypeScript interfaces
    │   ├── prompts.ts             — system prompt builder
    │   ├── agent.ts               — OpenAI tool-use conversation loop
    │   ├── state.ts               — load/save conversation_state
    │   ├── vocabulary.ts          — learn + lookup personal vocabulary
    │   ├── cards.ts               — card resolution + duplicate detection
    │   ├── media.ts               — audio/image/PDF processing
    │   ├── db/
    │   │   └── supabase.ts        — typed Supabase client (finn schema)
    │   └── tools/
    │       ├── save-transaction.ts
    │       ├── update-transaction.ts
    │       ├── delete-transaction.ts
    │       └── query-spending.ts
    └── tests/
        ├── types.test.ts
        ├── prompts.test.ts
        ├── state.test.ts
        ├── vocabulary.test.ts
        ├── cards.test.ts
        ├── media.test.ts
        └── tools/
            ├── save-transaction.test.ts
            ├── update-transaction.test.ts
            ├── delete-transaction.test.ts
            └── query-spending.test.ts
```

---

## Sprint 1 — Foundation (Day 1–2)

### Task 1: VPS Setup — Node 24 + OpenClaw + PM2

**Files:** (VPS terminal — no repo files changed)

- [ ] **Step 1: SSH into your VPS**

```bash
ssh root@YOUR_VPS_IP
```

- [ ] **Step 2: Install Node 24**

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # should print v24.x.x
```

- [ ] **Step 3: Install OpenClaw + PM2 globally**

```bash
npm i -g openclaw pm2
openclaw --version   # should print version
pm2 --version
```

- [ ] **Step 4: Connect WhatsApp (QR code)**

```bash
openclaw channels login --channel whatsapp
# A QR code appears in the terminal.
# Open WhatsApp on your dedicated number → Linked Devices → Link a Device → scan QR
# Expected: "WhatsApp connected successfully"
```

- [ ] **Step 5: Verify gateway starts**

```bash
openclaw gateway &
# Expected: "Gateway listening on port 18789"
# Kill it for now — PM2 will manage it later
kill %1
```

- [ ] **Step 6: Install nginx + certbot**

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN
# Follow prompts — enter email, agree to ToS
# Expected: "Successfully deployed certificate for YOUR_DOMAIN"
```

- [ ] **Step 7: Commit infra notes**

```bash
# Back on your local machine:
cd /Users/vicentejr/dev/finn
cat > infra/vps-setup.md << 'EOF'
# VPS Setup Checklist
- [x] Node 24
- [x] OpenClaw (latest)
- [x] PM2
- [x] WhatsApp connected
- [x] nginx + SSL (certbot)
EOF
git add infra/
git commit -m "docs: add VPS setup checklist"
git push
```

---

### Task 2: Supabase Schema Migration

**Files:**
- Create: `migrations/001_init.sql`

- [ ] **Step 1: Write the migration file**

```bash
mkdir -p /Users/vicentejr/dev/finn/migrations
```

Create `migrations/001_init.sql`:

```sql
-- ============================================================
-- Finn schema — run in Supabase SQL editor
-- Also go to: Settings → API → Exposed schemas → add "finn"
-- ============================================================

CREATE SCHEMA IF NOT EXISTS finn;

-- ── transactions ────────────────────────────────────────────
CREATE TABLE finn.transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'expense'
              CHECK (type IN ('expense','income','card_payment')),
  amount      NUMERIC(10,2) NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  cost_center TEXT NOT NULL
              CHECK (cost_center IN ('Me','Lilian','Eddie','Apto Taman','Carro','Família')),
  card        TEXT CHECK (card IN ('Mastercard','Visa','Aeternum')),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  source      TEXT NOT NULL CHECK (source IN ('text','audio','pdf','image')),
  raw_input   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_transactions_phone_date ON finn.transactions(phone, date DESC);
CREATE INDEX idx_transactions_phone_card ON finn.transactions(phone, card);

-- ── categories ──────────────────────────────────────────────
CREATE TABLE finn.categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO finn.categories (name) VALUES
  ('Alimentação'),('Supermercado'),('Farmácia'),('Transporte'),
  ('Saúde'),('Lazer'),('Educação'),('Moradia'),('Vestuário'),('Outros');

-- ── credit_cards ────────────────────────────────────────────
CREATE TABLE finn.credit_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  due_day     INT NOT NULL,
  closing_day INT,
  is_default  BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO finn.credit_cards (name, due_day, is_default) VALUES
  ('Mastercard', 15, true),
  ('Visa',       25, false),
  ('Aeternum',   10, false);

-- ── vocabulary ──────────────────────────────────────────────
CREATE TABLE finn.vocabulary (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  term        TEXT NOT NULL,
  category    TEXT NOT NULL,
  card        TEXT,
  cost_center TEXT,
  confidence  INT DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(phone, term)
);

CREATE INDEX idx_vocabulary_phone ON finn.vocabulary(phone);

-- ── conversation_state ──────────────────────────────────────
CREATE TABLE finn.conversation_state (
  phone                 TEXT PRIMARY KEY,
  state                 TEXT NOT NULL DEFAULT 'idle'
                        CHECK (state IN ('idle','awaiting_confirm','awaiting_edit_confirm')),
  pending_transaction   JSONB,
  target_transaction_id UUID REFERENCES finn.transactions(id) ON DELETE SET NULL,
  history               JSONB DEFAULT '[]',
  updated_at            TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2: Run migration in Supabase**

Go to your Supabase project → SQL Editor → paste the full file → Run.

Expected: All tables created with no errors.

- [ ] **Step 3: Expose the finn schema in Supabase**

Go to: **Settings → API → Exposed schemas** → click `+` → type `finn` → Save.

- [ ] **Step 4: Commit migration**

```bash
cd /Users/vicentejr/dev/finn
git add migrations/001_init.sql
git commit -m "feat: add finn schema migration — 5 tables"
git push
```

---

### Task 3: Plugin TypeScript Scaffold

**Files:**
- Create: `plugin/package.json`
- Create: `plugin/tsconfig.json`
- Create: `plugin/manifest.json`
- Create: `plugin/src/types.ts`

- [ ] **Step 1: Initialize plugin package**

```bash
cd /Users/vicentejr/dev/finn
mkdir -p plugin/src/tools plugin/src/db plugin/tests/tools
cd plugin
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install openai @supabase/supabase-js pdf-parse
npm install --save-dev typescript @types/node @types/pdf-parse vitest ts-node
```

- [ ] **Step 3: Write `plugin/package.json`**

```json
{
  "name": "finance-agent",
  "version": "1.0.0",
  "description": "Finn — personal finance agent for OpenClaw",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "openai": "^4.52.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/pdf-parse": "^1.1.4",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 4: Write `plugin/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Write `plugin/manifest.json`**

```json
{
  "name": "finance-agent",
  "version": "1.0.0",
  "description": "Finn — personal finance assistant. Logs expenses, income, and card transactions via WhatsApp.",
  "main": "dist/index.js",
  "tools": [
    {
      "name": "finance_agent",
      "description": "Routes WhatsApp messages to Finn, the personal finance assistant. Handles text, audio, images, and PDFs."
    }
  ]
}
```

- [ ] **Step 6: Write `plugin/src/types.ts`**

```typescript
// All shared interfaces for the Finn finance agent

export type TransactionType = 'expense' | 'income' | 'card_payment'
export type CostCenter = 'Me' | 'Lilian' | 'Eddie' | 'Apto Taman' | 'Carro' | 'Família'
export type CardName = 'Mastercard' | 'Visa' | 'Aeternum'
export type MediaSource = 'text' | 'audio' | 'pdf' | 'image'
export type ConversationStateType = 'idle' | 'awaiting_confirm' | 'awaiting_edit_confirm'

export const COST_CENTERS: CostCenter[] = ['Me', 'Lilian', 'Eddie', 'Apto Taman', 'Carro', 'Família']
export const CARDS: CardName[] = ['Mastercard', 'Visa', 'Aeternum']
export const CASH_KEYWORDS = ['pix', 'dinheiro', 'débito', 'debito', 'cash', 'especie', 'espécie']
export const DEFAULT_CARD: CardName = 'Mastercard'

export interface PendingTransaction {
  type: TransactionType
  amount: number
  description: string
  category: string
  cost_center: CostCenter
  card: CardName | null
  date: string           // ISO: YYYY-MM-DD
  source: MediaSource
  raw_input: string
}

export interface Transaction extends PendingTransaction {
  id: string
  phone: string
  created_at: string
  updated_at: string
}

export interface ConversationStateRow {
  phone: string
  state: ConversationStateType
  pending_transaction: PendingTransaction | null
  target_transaction_id: string | null
  history: ChatMessage[]
  updated_at: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface VocabularyEntry {
  id: string
  phone: string
  term: string
  category: string
  card: CardName | null
  cost_center: CostCenter | null
  confidence: number
}

export interface CreditCard {
  id: string
  name: CardName
  due_day: number
  closing_day: number | null
  is_default: boolean
}

export interface Category {
  id: string
  name: string
}

export interface AgentInput {
  phone: string
  message: string
  mediaType?: MediaSource
  mediaData?: string   // base64 for audio/image, raw text for pdf
}

export interface AgentResult {
  reply: string
}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/vicentejr/dev/finn/plugin
npx tsc --noEmit
# Expected: no errors
```

- [ ] **Step 8: Commit scaffold**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/
git commit -m "feat: scaffold plugin — TypeScript, manifest, types"
git push
```

---

## Sprint 2 — Plugin Core (Day 3–4)

### Task 4: Supabase Client

**Files:**
- Create: `plugin/src/db/supabase.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/supabase.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test that the client uses the finn schema
describe('supabase client', () => {
  it('uses finn schema', async () => {
    // The client module must be imported lazily (after env is set)
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'test-key'

    const { db } = await import('../src/db/supabase.js')
    // db() should return a client — if env missing it throws
    expect(db).toBeDefined()
  })

  it('throws if SUPABASE_URL is missing', async () => {
    delete process.env.SUPABASE_URL
    process.env.SUPABASE_SERVICE_KEY = 'test-key'

    vi.resetModules()
    await expect(import('../src/db/supabase.js')).rejects.toThrow('SUPABASE_URL')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/vicentejr/dev/finn/plugin
npx vitest run tests/supabase.test.ts
# Expected: FAIL — "Cannot find module '../src/db/supabase.js'"
```

- [ ] **Step 3: Implement `plugin/src/db/supabase.ts`**

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type {
  Transaction,
  ConversationStateRow,
  VocabularyEntry,
  CreditCard,
  Category,
} from '../types.js'

export interface Database {
  finn: {
    Tables: {
      transactions: { Row: Transaction }
      conversation_state: { Row: ConversationStateRow }
      vocabulary: { Row: VocabularyEntry }
      credit_cards: { Row: CreditCard }
      categories: { Row: Category }
    }
  }
}

let _client: SupabaseClient<Database> | null = null

export function db(): SupabaseClient<Database> {
  if (_client) return _client

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY

  if (!url) throw new Error('SUPABASE_URL environment variable is required')
  if (!key) throw new Error('SUPABASE_SERVICE_KEY environment variable is required')

  _client = createClient<Database>(url, key, {
    db: { schema: 'finn' },
  })

  return _client
}

// Reset for testing
export function _resetClient(): void {
  _client = null
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/supabase.test.ts
# Expected: PASS (2 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/db/ plugin/tests/supabase.test.ts
git commit -m "feat: add Supabase client — finn schema, typed"
git push
```

---

### Task 5: System Prompt Builder

**Files:**
- Create: `plugin/src/prompts.ts`
- Create: `plugin/tests/prompts.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/prompts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../src/prompts.js'

describe('buildSystemPrompt', () => {
  it('includes Finn identity', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Finn')
  })

  it('includes all cost centers', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Me')
    expect(prompt).toContain('Lilian')
    expect(prompt).toContain('Eddie')
    expect(prompt).toContain('Apto Taman')
    expect(prompt).toContain('Carro')
    expect(prompt).toContain('Família')
  })

  it('includes Mastercard as default card', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('Mastercard')
    expect(prompt).toContain('default')
  })

  it('injects vocabulary into prompt', () => {
    const vocab = [
      { term: 'buteco', category: 'Bar', card: null, cost_center: null, confidence: 3 },
    ]
    const prompt = buildSystemPrompt(vocab as any)
    expect(prompt).toContain('buteco')
    expect(prompt).toContain('Bar')
  })

  it('includes state machine rules', () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain('confirm')
    expect(prompt).toContain('save')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/prompts.test.ts
# Expected: FAIL — "Cannot find module '../src/prompts.js'"
```

- [ ] **Step 3: Implement `plugin/src/prompts.ts`**

```typescript
import type { VocabularyEntry } from './types.js'

export function buildSystemPrompt(vocabulary: VocabularyEntry[]): string {
  const vocabSection =
    vocabulary.length > 0
      ? `\n## Your Personal Vocabulary\nThe user uses these terms — map them automatically:\n${vocabulary
          .map((v) => `- "${v.term}" → category: ${v.category}${v.card ? `, card: ${v.card}` : ''}${v.cost_center ? `, cost_center: ${v.cost_center}` : ''}${v.confidence >= 2 ? ' (apply silently)' : ' (apply but confirm)'}`)
          .join('\n')}`
      : ''

  return `You are Finn 💰, a personal finance assistant accessible via WhatsApp.

## Personality
- Warm, concise, and friendly — like a knowledgeable friend, never a bank chatbot
- Always respond in the same language the user last wrote in (PT-BR or English)
- Never judge spending habits
- Celebrate good financial behavior with short, genuine reactions

## Cost Centers (always assign one)
Me | Lilian | Eddie | Apto Taman | Carro | Família
Default: "Me" unless another is clearly indicated.

## Credit Cards
- Mastercard (DEFAULT — assume this when no card is mentioned)
- Visa
- Aeternum
- null = cash / pix / débito (keywords: pix, dinheiro, débito, cash)

## Transaction Types
- expense: money spent
- income: money received (salary, freelance, etc.)
- card_payment: paying a credit card bill

## Categories
Alimentação, Supermercado, Farmácia, Transporte, Saúde, Lazer, Educação, Moradia, Vestuário, Outros
You may create new categories when the user describes something that doesn't fit.
Normalize to Title Case.
${vocabSection}

## State Machine Rules — CRITICAL
1. NEVER call save_transaction without user confirmation first.
2. When you extract a transaction, present it clearly and ask for confirmation:
   "R\$20 · Alimentação · Mastercard · Me · hoje — confirma? ✅"
3. Only call save_transaction when the user says: sim / yes / 👍 / confirma / pode salvar
4. If the user says não / cancel / 👎 — discard and return to idle
5. If the user corrects data before confirming — update and ask again, do NOT save yet
6. Queries ("quanto gastei?") can be answered at any time without changing save state
7. For edits to already-saved transactions — find the record, show it, confirm before calling update_transaction
8. For deletes — show the record, confirm before calling delete_transaction

## Date & Currency Rules
- Assume today's date unless user specifies otherwise
- Assume BRL (R$) unless user specifies otherwise
- "ontem" = yesterday, "semana passada" = last week, etc.
- Always store dates as YYYY-MM-DD

## Ambiguity Rule
If you cannot determine a required field (amount, category, or cost_center), ask ONE short question. Never ask multiple questions at once.`
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/prompts.test.ts
# Expected: PASS (5 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/prompts.ts plugin/tests/prompts.test.ts
git commit -m "feat: add system prompt builder with vocabulary injection"
git push
```

---

### Task 6: Conversation State Manager

**Files:**
- Create: `plugin/src/state.ts`
- Create: `plugin/tests/state.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/state.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ConversationStateRow, PendingTransaction } from '../src/types.js'

// Mock Supabase
vi.mock('../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}))

describe('loadState', () => {
  it('returns default idle state for unknown phone', async () => {
    const { loadState } = await import('../src/state.js')
    const state = await loadState('+5511999990000')
    expect(state.state).toBe('idle')
    expect(state.pending_transaction).toBeNull()
    expect(state.history).toEqual([])
  })
})

describe('saveState', () => {
  it('saves state without throwing', async () => {
    const { saveState } = await import('../src/state.js')
    const state: ConversationStateRow = {
      phone: '+5511999990000',
      state: 'awaiting_confirm',
      pending_transaction: null,
      target_transaction_id: null,
      history: [],
      updated_at: new Date().toISOString(),
    }
    await expect(saveState(state)).resolves.not.toThrow()
  })
})

describe('defaultState', () => {
  it('creates idle state for a phone', async () => {
    const { defaultState } = await import('../src/state.js')
    const s = defaultState('+5511999990000')
    expect(s.phone).toBe('+5511999990000')
    expect(s.state).toBe('idle')
    expect(s.history).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/state.test.ts
# Expected: FAIL — module not found
```

- [ ] **Step 3: Implement `plugin/src/state.ts`**

```typescript
import { db } from './db/supabase.js'
import type { ConversationStateRow, ChatMessage } from './types.js'

export function defaultState(phone: string): ConversationStateRow {
  return {
    phone,
    state: 'idle',
    pending_transaction: null,
    target_transaction_id: null,
    history: [],
    updated_at: new Date().toISOString(),
  }
}

export async function loadState(phone: string): Promise<ConversationStateRow> {
  const { data, error } = await db()
    .from('conversation_state')
    .select('*')
    .eq('phone', phone)
    .single()

  if (error || !data) return defaultState(phone)
  return data as ConversationStateRow
}

export async function saveState(state: ConversationStateRow): Promise<void> {
  const { error } = await db()
    .from('conversation_state')
    .upsert({ ...state, updated_at: new Date().toISOString() }, { onConflict: 'phone' })

  if (error) throw new Error(`Failed to save state: ${error.message}`)
}

export function appendMessage(
  state: ConversationStateRow,
  role: 'user' | 'assistant',
  content: string,
  maxHistory = 20
): ConversationStateRow {
  const history: ChatMessage[] = [
    ...state.history,
    { role, content },
  ].slice(-maxHistory)

  return { ...state, history }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/state.test.ts
# Expected: PASS (3 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/state.ts plugin/tests/state.test.ts
git commit -m "feat: add conversation state manager — load, save, append"
git push
```

---

### Task 7: Save Transaction Tool

**Files:**
- Create: `plugin/src/tools/save-transaction.ts`
- Create: `plugin/tests/tools/save-transaction.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/tools/save-transaction.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: (table: string) => ({
      insert: async (data: any) => {
        if (table === 'transactions') return { data: [{ id: 'uuid-1', ...data }], error: null }
        if (table === 'categories') return { error: null }
        return { error: null }
      },
      select: () => ({
        ilike: () => ({ single: async () => ({ data: { id: 'cat-1', name: 'Alimentação' }, error: null }) }),
      }),
    }),
  }),
}))

describe('saveTransaction', () => {
  it('inserts a transaction and returns it', async () => {
    const { saveTransaction } = await import('../../src/tools/save-transaction.js')
    const result = await saveTransaction({
      phone: '+5511999990000',
      type: 'expense',
      amount: 20,
      description: 'almoço',
      category: 'Alimentação',
      cost_center: 'Me',
      card: 'Mastercard',
      date: '2026-04-18',
      source: 'text',
      raw_input: 'gastei 20 no almoço',
    })
    expect(result.id).toBe('uuid-1')
    expect(result.amount).toBe(20)
  })

  it('creates new category if it does not exist', async () => {
    vi.resetModules()
    vi.mock('../../src/db/supabase.js', () => ({
      db: () => ({
        from: (table: string) => ({
          insert: async (data: any) => ({ data: [{ id: 'uuid-2', ...data }], error: null }),
          select: () => ({
            ilike: () => ({ single: async () => ({ data: null, error: { code: 'PGRST116' } }) }),
          }),
        }),
      }),
    }))
    const { saveTransaction } = await import('../../src/tools/save-transaction.js')
    const result = await saveTransaction({
      phone: '+5511999990000',
      type: 'expense',
      amount: 80,
      description: 'pet shop',
      category: 'Pet Shop',
      cost_center: 'Me',
      card: 'Mastercard',
      date: '2026-04-18',
      source: 'text',
      raw_input: 'gastei 80 no pet shop',
    })
    expect(result.category).toBe('Pet Shop')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/tools/save-transaction.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/tools/save-transaction.ts`**

```typescript
import { db } from '../db/supabase.js'
import type { PendingTransaction, Transaction } from '../types.js'

function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .trim()
}

async function ensureCategoryExists(name: string): Promise<void> {
  const normalized = toTitleCase(name)
  const { data } = await db()
    .from('categories')
    .select('id')
    .ilike('name', normalized)
    .single()

  if (!data) {
    await db().from('categories').insert({ name: normalized })
  }
}

export async function saveTransaction(
  params: PendingTransaction & { phone: string }
): Promise<Transaction> {
  const category = toTitleCase(params.category)
  await ensureCategoryExists(category)

  const { data, error } = await db()
    .from('transactions')
    .insert({
      phone: params.phone,
      type: params.type,
      amount: params.amount,
      description: params.description,
      category,
      cost_center: params.cost_center,
      card: params.card,
      date: params.date,
      source: params.source,
      raw_input: params.raw_input,
    })
    .select()
    .single()

  if (error || !data) throw new Error(`Failed to save transaction: ${error?.message}`)
  return data as Transaction
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/tools/save-transaction.test.ts
# Expected: PASS (2 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/tools/save-transaction.ts plugin/tests/tools/save-transaction.test.ts
git commit -m "feat: add save_transaction tool — creates categories on the fly"
git push
```

---

### Task 8: Query Spending Tool

**Files:**
- Create: `plugin/src/tools/query-spending.ts`
- Create: `plugin/tests/tools/query-spending.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/tools/query-spending.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({
        eq: function(this: any) { return this },
        gte: function(this: any) { return this },
        lte: function(this: any) { return this },
        ilike: function(this: any) { return this },
        then: async (resolve: Function) => resolve({
          data: [
            { amount: 150.00, category: 'Alimentação', cost_center: 'Me', date: '2026-04-10', description: 'restaurante' },
            { amount: 50.00, category: 'Alimentação', cost_center: 'Me', date: '2026-04-15', description: 'almoço' },
          ],
          error: null,
        }),
      }),
    }),
  }),
}))

describe('querySpending', () => {
  it('returns formatted summary', async () => {
    const { querySpending } = await import('../../src/tools/query-spending.js')
    const result = await querySpending({
      phone: '+5511999990000',
      period: 'month',
      category: 'Alimentação',
    })
    expect(result.total).toBe(200)
    expect(result.count).toBe(2)
    expect(result.transactions).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/tools/query-spending.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/tools/query-spending.ts`**

```typescript
import { db } from '../db/supabase.js'
import type { Transaction } from '../types.js'

export interface QueryParams {
  phone: string
  period?: 'week' | 'month' | 'year' | 'all'
  category?: string
  cost_center?: string
  card?: string
  type?: 'expense' | 'income' | 'card_payment'
}

export interface QueryResult {
  total: number
  count: number
  transactions: Transaction[]
  by_category?: Record<string, number>
}

function getPeriodDates(period: QueryParams['period']): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString().split('T')[0]

  if (period === 'week') {
    const from = new Date(now)
    from.setDate(from.getDate() - 7)
    return { from: from.toISOString().split('T')[0], to }
  }
  if (period === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    return { from: from.toISOString().split('T')[0], to }
  }
  if (period === 'year') {
    const from = new Date(now.getFullYear(), 0, 1)
    return { from: from.toISOString().split('T')[0], to }
  }
  return { from: '2000-01-01', to }
}

export async function querySpending(params: QueryParams): Promise<QueryResult> {
  const { from, to } = getPeriodDates(params.period ?? 'month')

  let query = db()
    .from('transactions')
    .select('*')
    .eq('phone', params.phone)
    .gte('date', from)
    .lte('date', to)

  if (params.category) query = query.ilike('category', params.category)
  if (params.cost_center) query = query.eq('cost_center', params.cost_center)
  if (params.card) query = query.eq('card', params.card)
  if (params.type) query = query.eq('type', params.type)

  const { data, error } = await query
  if (error) throw new Error(`Query failed: ${error.message}`)

  const transactions = (data ?? []) as Transaction[]
  const total = transactions.reduce((sum, t) => sum + Number(t.amount), 0)

  const by_category = transactions.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] ?? 0) + Number(t.amount)
    return acc
  }, {})

  return { total: Math.round(total * 100) / 100, count: transactions.length, transactions, by_category }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/tools/query-spending.test.ts
# Expected: PASS (1 test)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/tools/query-spending.ts plugin/tests/tools/query-spending.test.ts
git commit -m "feat: add query_spending tool — period, category, cost_center filters"
git push
```

---

## Sprint 3 — Media + Intelligence (Day 5–6)

### Task 9: Media Processing — Audio, Image, PDF

**Files:**
- Create: `plugin/src/media.ts`
- Create: `plugin/tests/media.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/media.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('openai', () => ({
  default: class {
    audio = {
      transcriptions: {
        create: async () => ({ text: 'comprei remédio quarenta e cinco reais' }),
      },
    }
    chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: 'Receipt: R$45.00 Farmácia 2026-04-18' } }],
        }),
      },
    }
  },
}))

vi.mock('pdf-parse', () => ({
  default: async () => ({
    text: 'FATURA MASTERCARD\nVencimento: 15/05/2026\nFechamento: 16/04/2026\nTotal: R$ 2.340,00\nALIMENTACAO 40,00\nSUPERMERCADO 134,50',
  }),
}))

describe('transcribeAudio', () => {
  it('returns transcript text', async () => {
    const { transcribeAudio } = await import('../src/media.js')
    const result = await transcribeAudio(Buffer.from('fake-audio'), 'audio.ogg')
    expect(result).toBe('comprei remédio quarenta e cinco reais')
  })
})

describe('parseImage', () => {
  it('returns extracted text from image', async () => {
    const { parseImage } = await import('../src/media.js')
    const result = await parseImage('data:image/jpeg;base64,fakeb64')
    expect(result).toContain('45.00')
  })
})

describe('parsePdf', () => {
  it('extracts text from PDF buffer', async () => {
    const { parsePdf } = await import('../src/media.js')
    const result = await parsePdf(Buffer.from('fake-pdf'))
    expect(result).toContain('MASTERCARD')
    expect(result).toContain('2.340,00')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/media.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/media.ts`**

```typescript
import OpenAI from 'openai'
import pdfParse from 'pdf-parse'
import { Readable } from 'stream'

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required')
  return new OpenAI({ apiKey })
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  filename = 'audio.ogg'
): Promise<string> {
  const openai = getOpenAI()
  const file = new File([audioBuffer], filename, { type: 'audio/ogg' })

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'pt',
  })

  return response.text
}

export async function parseImage(imageUrlOrBase64: string): Promise<string> {
  const openai = getOpenAI()

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract ALL financial information from this image: amounts, descriptions, dates, merchant names. Return as plain text.',
          },
          {
            type: 'image_url',
            image_url: { url: imageUrlOrBase64, detail: 'high' },
          },
        ],
      },
    ],
    max_tokens: 1000,
  })

  return response.choices[0]?.message?.content ?? ''
}

export async function parsePdf(pdfBuffer: Buffer): Promise<string> {
  const result = await pdfParse(pdfBuffer)
  return result.text
}

export async function processMedia(
  mediaType: 'text' | 'audio' | 'image' | 'pdf',
  content: string | Buffer
): Promise<string> {
  switch (mediaType) {
    case 'text':
      return content as string
    case 'audio':
      return transcribeAudio(content as Buffer)
    case 'image':
      return parseImage(content as string)
    case 'pdf':
      return parsePdf(content as Buffer)
    default:
      return content as string
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/media.test.ts
# Expected: PASS (3 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/media.ts plugin/tests/media.test.ts
git commit -m "feat: add media processing — whisper-1 audio, gpt-4.1-mini vision, pdf-parse"
git push
```

---

### Task 10: Vocabulary Learning

**Files:**
- Create: `plugin/src/vocabulary.ts`
- Create: `plugin/tests/vocabulary.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/vocabulary.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { VocabularyEntry } from '../src/types.js'

const mockVocab: VocabularyEntry[] = [
  { id: '1', phone: '+55', term: 'buteco', category: 'Bar', card: null, cost_center: null, confidence: 3 },
  { id: '2', phone: '+55', term: 'almoco', category: 'Alimentação', card: null, cost_center: null, confidence: 2 },
]

vi.mock('../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: mockVocab, error: null }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}))

describe('loadVocabulary', () => {
  it('returns vocabulary for phone', async () => {
    const { loadVocabulary } = await import('../src/vocabulary.js')
    const vocab = await loadVocabulary('+55')
    expect(vocab).toHaveLength(2)
    expect(vocab[0].term).toBe('buteco')
  })
})

describe('normalizeTerm', () => {
  it('lowercases and strips accents', async () => {
    const { normalizeTerm } = await import('../src/vocabulary.js')
    expect(normalizeTerm('Almoço')).toBe('almoco')
    expect(normalizeTerm('BUTECO')).toBe('buteco')
    expect(normalizeTerm('  farmácia  ')).toBe('farmacia')
  })
})

describe('learnMapping', () => {
  it('upserts vocabulary without throwing', async () => {
    const { learnMapping } = await import('../src/vocabulary.js')
    await expect(
      learnMapping('+55', 'buteco', 'Bar', null, null)
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/vocabulary.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/vocabulary.ts`**

```typescript
import { db } from './db/supabase.js'
import type { VocabularyEntry, CardName, CostCenter } from './types.js'

export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
}

export async function loadVocabulary(phone: string): Promise<VocabularyEntry[]> {
  const { data, error } = await db()
    .from('vocabulary')
    .select('*')
    .eq('phone', phone)

  if (error) return []
  return (data ?? []) as VocabularyEntry[]
}

export async function learnMapping(
  phone: string,
  term: string,
  category: string,
  card: CardName | null,
  cost_center: CostCenter | null,
  confidenceDelta = 1
): Promise<void> {
  const normalized = normalizeTerm(term)

  // Try to increment existing confidence, or insert new
  const { data: existing } = await db()
    .from('vocabulary')
    .select('id, confidence')
    .eq('phone', phone)
    .eq('term', normalized)
    .single()

  const newConfidence = existing ? existing.confidence + confidenceDelta : 1

  await db().from('vocabulary').upsert(
    {
      phone,
      term: normalized,
      category,
      card,
      cost_center,
      confidence: newConfidence,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone,term' }
  )
}

export async function correctMapping(
  phone: string,
  term: string,
  newCategory: string,
  card: CardName | null,
  cost_center: CostCenter | null
): Promise<void> {
  // Reset confidence to 1 when user corrects a mapping
  const normalized = normalizeTerm(term)
  await db().from('vocabulary').upsert(
    {
      phone,
      term: normalized,
      category: newCategory,
      card,
      cost_center,
      confidence: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'phone,term' }
  )
}

export function extractTermsFromDescription(description: string): string[] {
  // Extract meaningful words (3+ chars, not stop words)
  const stopWords = new Set(['no', 'na', 'em', 'de', 'do', 'da', 'um', 'uma', 'the', 'for', 'in'])
  return description
    .toLowerCase()
    .split(/\s+/)
    .map(normalizeTerm)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/vocabulary.test.ts
# Expected: PASS (3 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/vocabulary.ts plugin/tests/vocabulary.test.ts
git commit -m "feat: add vocabulary learning — normalize, upsert, confidence scoring"
git push
```

---

### Task 11: Credit Card Intelligence

**Files:**
- Create: `plugin/src/cards.ts`
- Create: `plugin/tests/cards.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/cards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('resolveCard', () => {
  it('detects explicit card mentions', async () => {
    const { resolveCard } = await import('../src/cards.js')
    expect(resolveCard('gastei 40 mastercard')).toBe('Mastercard')
    expect(resolveCard('almoco master')).toBe('Mastercard')
    expect(resolveCard('farmacia visa')).toBe('Visa')
    expect(resolveCard('uber aeternum')).toBe('Aeternum')
  })

  it('returns default card when no card mentioned', async () => {
    const { resolveCard } = await import('../src/cards.js')
    expect(resolveCard('gastei 20 no almoço')).toBe('Mastercard')
  })

  it('returns null for cash/pix keywords', async () => {
    const { resolveCard } = await import('../src/cards.js')
    expect(resolveCard('paguei 20 no pix')).toBeNull()
    expect(resolveCard('dinheiro 50 farmacia')).toBeNull()
    expect(resolveCard('pagou debito')).toBeNull()
  })
})

describe('detectDuplicates', () => {
  it('flags transactions with same card, close amount and date', async () => {
    const { detectDuplicates } = await import('../src/cards.js')
    const existing = [
      { id: '1', amount: 40.00, date: '2026-04-18', card: 'Mastercard', description: 'restaurante' },
      { id: '2', amount: 134.50, date: '2026-04-15', card: 'Mastercard', description: 'supermercado' },
    ]
    const incoming = [
      { amount: 40.00, date: '2026-04-18', card: 'Mastercard', description: 'RESTAURANTE ABC' },
      { amount: 200.00, date: '2026-04-20', card: 'Mastercard', description: 'diferente' },
    ]
    const dupes = detectDuplicates(incoming as any, existing as any)
    expect(dupes).toHaveLength(1)
    expect(dupes[0].existingId).toBe('1')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/cards.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/cards.ts`**

```typescript
import type { CardName, Transaction } from './types.js'
import { CARDS, CASH_KEYWORDS, DEFAULT_CARD } from './types.js'
import { db } from './db/supabase.js'

const CARD_ALIASES: Record<string, CardName> = {
  mastercard: 'Mastercard',
  master: 'Mastercard',
  visa: 'Visa',
  aeternum: 'Aeternum',
}

export function resolveCard(message: string): CardName | null {
  const lower = message.toLowerCase()

  // Check for cash/pix keywords first
  if (CASH_KEYWORDS.some((k) => lower.includes(k))) return null

  // Check explicit card names
  for (const [alias, cardName] of Object.entries(CARD_ALIASES)) {
    if (lower.includes(alias)) return cardName
  }

  // Default
  return DEFAULT_CARD
}

export interface DuplicateMatch {
  incomingIndex: number
  existingId: string
  reason: string
}

export function detectDuplicates(
  incoming: Array<{ amount: number; date: string; card: string | null; description?: string }>,
  existing: Array<{ id: string; amount: number; date: string; card: string | null; description?: string }>
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = []

  incoming.forEach((inc, i) => {
    for (const ext of existing) {
      if (inc.card !== ext.card) continue

      const amountDiff = Math.abs(inc.amount - ext.amount) / Math.max(inc.amount, ext.amount)
      if (amountDiff > 0.01) continue  // more than 1% diff → not a duplicate

      const incDate = new Date(inc.date).getTime()
      const extDate = new Date(ext.date).getTime()
      const daysDiff = Math.abs(incDate - extDate) / (1000 * 60 * 60 * 24)
      if (daysDiff > 3) continue  // more than 3 days apart → not a duplicate

      matches.push({
        incomingIndex: i,
        existingId: ext.id,
        reason: `R$${inc.amount} · ${inc.card} · ${inc.date} matches existing entry`,
      })
      break
    }
  })

  return matches
}

export async function updateCardCycleFromPdf(
  cardName: CardName,
  closingDay: number,
  dueDay: number
): Promise<void> {
  await db()
    .from('credit_cards')
    .update({ closing_day: closingDay, due_day: dueDay })
    .eq('name', cardName)
}

export async function getCardsNearDueDate(daysAhead = 3): Promise<Array<{ name: CardName; due_day: number }>> {
  const today = new Date().getDate()
  const { data, error } = await db().from('credit_cards').select('name, due_day')
  if (error || !data) return []

  return (data as Array<{ name: CardName; due_day: number }>).filter((card) => {
    const daysUntilDue = card.due_day >= today ? card.due_day - today : 30 - today + card.due_day
    return daysUntilDue <= daysAhead
  })
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/cards.test.ts
# Expected: PASS (3 tests)
```

- [ ] **Step 5: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/cards.ts plugin/tests/cards.test.ts
git commit -m "feat: add card intelligence — resolve card, detect duplicates, learn from PDF"
git push
```

---

### Task 12: Update + Delete Transaction Tools

**Files:**
- Create: `plugin/src/tools/update-transaction.ts`
- Create: `plugin/src/tools/delete-transaction.ts`
- Create: `plugin/tests/tools/update-transaction.test.ts`
- Create: `plugin/tests/tools/delete-transaction.test.ts`

- [ ] **Step 1: Write failing tests**

Create `plugin/tests/tools/update-transaction.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'uuid-1', amount: 25, category: 'Alimentação', cost_center: 'Me', card: 'Mastercard' },
              error: null,
            }),
          }),
        }),
      }),
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({
              data: [{ id: 'uuid-1', amount: 20, description: 'almoço', category: 'Alimentação', cost_center: 'Me', card: 'Mastercard', date: '2026-04-18' }],
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}))

describe('findTransaction', () => {
  it('finds last matching transaction by description', async () => {
    const { findTransaction } = await import('../../src/tools/update-transaction.js')
    const result = await findTransaction('+55', 'almoço')
    expect(result).not.toBeNull()
    expect(result?.id).toBe('uuid-1')
  })
})

describe('updateTransaction', () => {
  it('updates specified fields', async () => {
    const { updateTransaction } = await import('../../src/tools/update-transaction.js')
    const result = await updateTransaction('uuid-1', { amount: 25 })
    expect(result.amount).toBe(25)
  })
})
```

Create `plugin/tests/tools/delete-transaction.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      delete: () => ({
        eq: async () => ({ error: null }),
      }),
    }),
  }),
}))

describe('deleteTransaction', () => {
  it('deletes by id without throwing', async () => {
    const { deleteTransaction } = await import('../../src/tools/delete-transaction.js')
    await expect(deleteTransaction('uuid-1')).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/tools/update-transaction.test.ts tests/tools/delete-transaction.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/tools/update-transaction.ts`**

```typescript
import { db } from '../db/supabase.js'
import type { Transaction } from '../types.js'

export async function findTransaction(
  phone: string,
  hint: string
): Promise<Transaction | null> {
  const { data, error } = await db()
    .from('transactions')
    .select('*')
    .eq('phone', phone)
    .ilike('description', `%${hint}%`)
    .order('date', { ascending: false })
    .limit(1)

  if (error || !data?.length) return null
  return data[0] as Transaction
}

export async function updateTransaction(
  id: string,
  fields: Partial<Pick<Transaction, 'amount' | 'category' | 'cost_center' | 'card' | 'date' | 'description'>>
): Promise<Transaction> {
  const { data, error } = await db()
    .from('transactions')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error || !data) throw new Error(`Failed to update transaction: ${error?.message}`)
  return data as Transaction
}
```

- [ ] **Step 4: Implement `plugin/src/tools/delete-transaction.ts`**

```typescript
import { db } from '../db/supabase.js'

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await db()
    .from('transactions')
    .delete()
    .eq('id', id)

  if (error) throw new Error(`Failed to delete transaction: ${error.message}`)
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/tools/update-transaction.test.ts tests/tools/delete-transaction.test.ts
# Expected: PASS (3 tests)
```

- [ ] **Step 6: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/tools/update-transaction.ts plugin/src/tools/delete-transaction.ts \
        plugin/tests/tools/update-transaction.test.ts plugin/tests/tools/delete-transaction.test.ts
git commit -m "feat: add update_transaction and delete_transaction tools"
git push
```

---

## Sprint 4 — Agent Loop + OpenClaw Config (Day 7–8)

### Task 13: Main Agent Conversation Loop

**Files:**
- Create: `plugin/src/agent.ts`
- Create: `plugin/tests/agent.test.ts`

- [ ] **Step 1: Write failing test**

Create `plugin/tests/agent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/db/supabase.js', () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}))

vi.mock('openai', () => ({
  default: class {
    chat = {
      completions: {
        create: async () => ({
          choices: [{
            message: {
              role: 'assistant',
              content: 'R$20 · Alimentação · Mastercard · Me · hoje — confirma? ✅',
              tool_calls: null,
            },
          }],
        }),
      },
    }
  },
}))

describe('runAgent', () => {
  it('returns a reply string', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_KEY = 'test-key'

    const { runAgent } = await import('../src/agent.js')
    const result = await runAgent({
      phone: '+5511999990000',
      message: 'gastei 20 no almoço',
      mediaType: 'text',
    })
    expect(result.reply).toBeTruthy()
    expect(typeof result.reply).toBe('string')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run tests/agent.test.ts
# Expected: FAIL
```

- [ ] **Step 3: Implement `plugin/src/agent.ts`**

```typescript
import OpenAI from 'openai'
import { loadState, saveState, appendMessage } from './state.js'
import { loadVocabulary, learnMapping, extractTermsFromDescription } from './vocabulary.js'
import { buildSystemPrompt } from './prompts.js'
import { processMedia } from './media.js'
import { saveTransaction } from './tools/save-transaction.js'
import { querySpending } from './tools/query-spending.js'
import { updateTransaction, findTransaction } from './tools/update-transaction.js'
import { deleteTransaction } from './tools/delete-transaction.js'
import type { AgentInput, AgentResult, PendingTransaction, CostCenter, CardName, MediaSource } from './types.js'

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
          cost_center: { type: 'string', enum: ['Me', 'Lilian', 'Eddie', 'Apto Taman', 'Carro', 'Família'] },
          card: { type: 'string', enum: ['Mastercard', 'Visa', 'Aeternum'], nullable: true },
          date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
          source: { type: 'string', enum: ['text', 'audio', 'pdf', 'image'] },
        },
        required: ['type', 'amount', 'category', 'cost_center', 'date', 'source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_spending',
      description: 'Query the user spending history. Use for questions like "how much did I spend this month?"',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['week', 'month', 'year', 'all'] },
          category: { type: 'string' },
          cost_center: { type: 'string' },
          card: { type: 'string' },
          type: { type: 'string', enum: ['expense', 'income', 'card_payment'] },
        },
        required: ['period'],
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
]

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  return new OpenAI({ apiKey })
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

  // 2. Load state + vocabulary
  let state = await loadState(input.phone)
  const vocabulary = await loadVocabulary(input.phone)

  // 3. Build messages
  state = appendMessage(state, 'user', userText)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: buildSystemPrompt(vocabulary) },
    ...state.history.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
  ]

  // 4. Call OpenAI — tool-use loop
  let finalReply = ''
  let iterations = 0
  const maxIterations = 5

  while (iterations < maxIterations) {
    iterations++
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    })

    const choice = response.choices[0]
    if (!choice) break

    const assistantMsg = choice.message
    messages.push(assistantMsg)

    // No tool calls — final reply
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
          const tx = await saveTransaction({ ...args, phone: input.phone, raw_input: input.message })
          toolResult = JSON.stringify({ success: true, id: tx.id, amount: tx.amount, category: tx.category })

          // Learn vocabulary from confirmed transaction
          if (args.description) {
            const terms = extractTermsFromDescription(args.description)
            for (const term of terms) {
              await learnMapping(input.phone, term, args.category, args.card ?? null, args.cost_center ?? null)
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
            const updated = await updateTransaction(found.id, fields)
            toolResult = JSON.stringify({ success: true, ...updated })
            state.state = 'idle'
          }
        } else if (toolCall.function.name === 'delete_transaction') {
          await deleteTransaction(args.transaction_id)
          toolResult = JSON.stringify({ success: true })
          state.state = 'idle'
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

  // 5. Persist state + history
  state = appendMessage(state, 'assistant', finalReply)
  await saveState(state)

  return { reply: finalReply }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run tests/agent.test.ts
# Expected: PASS (1 test)
```

- [ ] **Step 5: Compile TypeScript**

```bash
cd /Users/vicentejr/dev/finn/plugin
npm run build
# Expected: dist/ folder created, no errors
```

- [ ] **Step 6: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/agent.ts plugin/tests/agent.test.ts
git commit -m "feat: add main agent loop — OpenAI tool-use, state machine, vocabulary learning"
git push
```

---

### Task 14: Plugin Entry Point + OpenClaw Config Files

**Files:**
- Create: `plugin/src/index.ts`
- Create: `openclaw/SOUL.md`
- Create: `openclaw/AGENTS.md`
- Create: `openclaw/IDENTITY.md`

- [ ] **Step 1: Write `plugin/src/index.ts`**

```typescript
import { runAgent } from './agent.js'
import type { AgentInput } from './types.js'

// OpenClaw plugin entry point
// Registers the finance_agent tool with the OpenClaw gateway

const plugin = {
  name: 'finance-agent',
  version: '1.0.0',

  tools: [
    {
      name: 'finance_agent',
      description:
        'Personal finance assistant Finn. Handles expense/income logging, credit card tracking, and spending queries via natural conversation.',
      parameters: {
        type: 'object',
        properties: {
          phone: {
            type: 'string',
            description: 'User WhatsApp phone number (e.g. +5511999990000)',
          },
          message: {
            type: 'string',
            description: 'The text content of the message (after media processing if applicable)',
          },
          mediaType: {
            type: 'string',
            enum: ['text', 'audio', 'image', 'pdf'],
            description: 'Type of the original media',
          },
          mediaData: {
            type: 'string',
            description: 'Base64 encoded media content (for audio/image/pdf)',
          },
        },
        required: ['phone', 'message'],
      },

      handler: async (params: AgentInput) => {
        const result = await runAgent(params)
        return result.reply
      },
    },
  ],
}

export default plugin
```

- [ ] **Step 2: Compile and verify**

```bash
cd /Users/vicentejr/dev/finn/plugin
npm run build
ls dist/
# Expected: index.js, agent.js, state.js, media.js, vocabulary.js, cards.js, prompts.js, types.js + tools/ + db/
```

- [ ] **Step 3: Write `openclaw/SOUL.md`**

```bash
mkdir -p /Users/vicentejr/dev/finn/openclaw
```

Create `openclaw/SOUL.md`:

```markdown
# Finn's Soul

## Identity
You are Finn 💰 — a personal finance assistant. You live in WhatsApp and help your user track every real and digital transaction in their life.

## Personality
- Warm and direct, like a trusted friend who happens to understand money
- Concise — never pad replies with unnecessary words
- Bilingual — always reply in the exact language the user wrote in last (PT-BR or English)
- Never judgmental about spending habits
- Celebratory when the user logs something good: "💪 Salvo!" or "✅ Anotado!"

## What You Never Do
- Never save anything without explicit user confirmation
- Never ask multiple questions at once — one at a time
- Never expose raw database errors to the user — apologize and offer to try again
- Never pretend to remember things from before the current conversation history

## Tone Examples
User: "gastei 20 no almoço"
Finn: "R$20 · Alimentação · Mastercard · Me · hoje — confirma? ✅"

User: "sim"
Finn: "Salvo! 💰 Alimentação está em R$87 esse mês."

User: "quanto gastei essa semana?"
Finn: "Essa semana: R$234,50 em 8 transações. Maior gasto: R$87 no supermercado (ontem)."
```

- [ ] **Step 4: Write `openclaw/AGENTS.md`**

Create `openclaw/AGENTS.md`:

```markdown
# Agent Instructions

## Primary Rule
Route ALL WhatsApp messages through the `finance_agent` tool provided by the finance-agent plugin.

## How to call it
Pass:
- `phone`: the sender's phone number
- `message`: the text content of their message
- `mediaType`: "audio", "image", "pdf", or "text"
- `mediaData`: base64 content if media (audio/image/pdf), omit for text

## Media Handling
- Voice notes → mediaType: "audio", mediaData: base64 audio bytes
- Images → mediaType: "image", mediaData: base64 or data URL
- PDFs → mediaType: "pdf", mediaData: base64 PDF bytes
- Text → mediaType: "text", no mediaData needed

## Important
Never try to answer finance questions yourself. Always delegate to the finance_agent tool.
The tool manages its own conversation state — pass the raw user message, it handles everything else.
```

- [ ] **Step 5: Write `openclaw/IDENTITY.md`**

Create `openclaw/IDENTITY.md`:

```markdown
# Identity

**Name:** Finn
**Emoji:** 💰
**Tagline:** Your personal finance buddy

Finn is focused, warm, and always in your corner financially.
```

- [ ] **Step 6: Run all tests**

```bash
cd /Users/vicentejr/dev/finn/plugin
npx vitest run
# Expected: all tests pass
```

- [ ] **Step 7: Commit**

```bash
cd /Users/vicentejr/dev/finn
git add plugin/src/index.ts openclaw/
git commit -m "feat: add plugin entry point + OpenClaw config files (SOUL, AGENTS, IDENTITY)"
git push
```

---

### Task 15: VPS Deployment

**Files:** (VPS terminal — deployment steps)

- [ ] **Step 1: Push to VPS via SSH**

```bash
# On your local machine
ssh root@YOUR_VPS_IP "mkdir -p /opt/finn"
scp -r /Users/vicentejr/dev/finn root@YOUR_VPS_IP:/opt/finn
```

- [ ] **Step 2: Copy OpenClaw config files**

```bash
ssh root@YOUR_VPS_IP
cp /opt/finn/openclaw/SOUL.md ~/.openclaw/workspace/SOUL.md
cp /opt/finn/openclaw/AGENTS.md ~/.openclaw/workspace/AGENTS.md
cp /opt/finn/openclaw/IDENTITY.md ~/.openclaw/workspace/IDENTITY.md
```

- [ ] **Step 3: Install plugin dependencies and build**

```bash
cd /opt/finn/plugin
npm install
npm run build
ls dist/   # verify compiled files exist
```

- [ ] **Step 4: Link plugin to OpenClaw workspace**

```bash
mkdir -p ~/.openclaw/workspace/plugins
ln -s /opt/finn/plugin ~/.openclaw/workspace/plugins/finance-agent
```

- [ ] **Step 5: Set environment variables**

```bash
openclaw configure
# When prompted, set:
#   OPENAI_API_KEY=sk-...
#   SUPABASE_URL=https://xxxxx.supabase.co
#   SUPABASE_SERVICE_KEY=eyJ...
```

- [ ] **Step 6: Start gateway with PM2**

```bash
pm2 start "openclaw gateway" --name finn
pm2 save
pm2 startup   # follow the printed command to enable auto-start
```

- [ ] **Step 7: Verify end-to-end**

```bash
pm2 logs finn --lines 20
# Expected: "Gateway listening on port 18789"
# Expected: "WhatsApp connected"
# Expected: "finance-agent plugin loaded"
```

Send a test message from your WhatsApp:
```
gastei 20 no almoço
```
Expected reply:
```
R$20 · Alimentação · Mastercard · Me · hoje — confirma? ✅
```

Reply "sim" — expected:
```
Salvo! 💰
```

Check Supabase: `SELECT * FROM finn.transactions ORDER BY created_at DESC LIMIT 1;`
Expected: 1 row with amount=20, category='Alimentação'.

- [ ] **Step 8: Configure nginx reverse proxy**

```bash
cat > /etc/nginx/sites-available/finn << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:18789;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -s /etc/nginx/sites-available/finn /etc/nginx/sites-enabled/
nginx -t  # Expected: "syntax is ok"
systemctl reload nginx
certbot --nginx -d YOUR_DOMAIN  # if not done in Task 1
```

- [ ] **Step 9: Final smoke test**

```bash
curl https://YOUR_DOMAIN/health
# Expected: {"status":"ok","version":"..."}
```

- [ ] **Step 10: Commit deployment notes**

```bash
# Back on local machine
cd /Users/vicentejr/dev/finn
git add infra/
git commit -m "docs: update deployment notes — PM2, nginx, plugin linked"
git push
```

---

### Task 16: Run Full Test Suite + Verify Coverage

- [ ] **Step 1: Run all tests**

```bash
cd /Users/vicentejr/dev/finn/plugin
npx vitest run --reporter=verbose
```

Expected output:
```
✓ tests/supabase.test.ts (2 tests)
✓ tests/prompts.test.ts (5 tests)
✓ tests/state.test.ts (3 tests)
✓ tests/vocabulary.test.ts (3 tests)
✓ tests/cards.test.ts (3 tests)
✓ tests/media.test.ts (3 tests)
✓ tests/tools/save-transaction.test.ts (2 tests)
✓ tests/tools/query-spending.test.ts (1 test)
✓ tests/tools/update-transaction.test.ts (2 tests)
✓ tests/tools/delete-transaction.test.ts (1 test)
✓ tests/agent.test.ts (1 test)

Test Files  11 passed (11)
Tests       26 passed (26)
```

- [ ] **Step 2: Fix any failing tests before proceeding**

If any test fails, read the error output and fix the source file. Do not skip or comment out failing tests.

- [ ] **Step 3: Final commit**

```bash
cd /Users/vicentejr/dev/finn
git add -A
git commit -m "test: all 26 tests passing — ready for challenge submission"
git push
```

---

## Appendix: Environment Variables

The plugin requires these environment variables on the VPS:

| Variable | Where to get it |
|---|---|
| `OPENAI_API_KEY` | platform.openai.com → API Keys |
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase project → Settings → API → service_role key |

Set via `openclaw configure` or by editing `~/.openclaw/openclaw.json`.

## Appendix: .env.example

Create `plugin/.env.example` (never commit real values):

```
OPENAI_API_KEY=sk-your-key-here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ...your-service-role-key...
```
