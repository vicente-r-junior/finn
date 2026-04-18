# Finn — Personal Finance Agent Design Spec

**Date:** 2026-04-18  
**Project:** Finn — OpenClaw-native personal finance agent  
**Challenge:** [OpenClaw Challenge 2026](https://dev.to/challenges/openclaw-2026-04-16)  
**Deadline:** April 26, 2026  
**Author:** Vicente Junior  

---

## 1. Overview

Finn is a personal finance assistant that lives on WhatsApp. The user sends messages in any format — text, voice note, image of a bill, PDF of a credit card invoice, or bank statement — and Finn extracts the expense data, confirms it with the user in natural language, and saves it to Supabase. Finn also answers spending queries conversationally.

The system is built entirely on **OpenClaw** (the challenge requirement), using a native OpenClaw plugin written in TypeScript for the finance intelligence, backed by **OpenAI APIs** for language and media processing, and **Supabase** for persistence.

---

## 2. Architecture

### 2.1 Components

```
WhatsApp (Baileys)
    ↕
OpenClaw Gateway  [Node.js, vicentejunior.tech, PM2]
    ├── SOUL.md         — Finn's personality
    ├── AGENTS.md       — routing instructions
    ├── IDENTITY.md     — name, emoji, vibe
    └── plugins/
        └── finance-agent/    ← THE BRAIN
            ├── index.ts      — registers tools with OpenClaw
            ├── agent.ts      — OpenAI tool-use loop
            ├── state.ts      — conversation state per phone
            ├── media.ts      — audio / PDF / image handling
            ├── tools/
            │   ├── save-expense.ts
            │   ├── update-expense.ts
            │   ├── delete-expense.ts
            │   └── query-spending.ts
            └── db/
                └── supabase.ts

External services:
  - OpenAI API (gpt-4.1-mini + whisper-1)
  - Supabase (PostgreSQL)
  - Let's Encrypt (SSL via certbot)
```

### 2.2 Infrastructure

| Component | Technology | Notes |
|---|---|---|
| VPS | Hostinger | vicentejunior.tech |
| WhatsApp | OpenClaw Baileys channel | QR code login, dedicated number |
| Process manager | PM2 | Auto-restart, survives reboots |
| SSL | nginx + certbot | HTTPS for vicentejunior.tech |
| Language model | gpt-4.1-mini | Text, vision, extraction |
| Audio | whisper-1 | Transcription only |
| Database | Supabase | Managed PostgreSQL |

### 2.3 Message Flow

```
User → WhatsApp → OpenClaw Gateway
  → finance-agent plugin (index.ts)
    → detect media type (text / audio / image / pdf)
    → process media if needed (Whisper / vision)
    → load conversation state from Supabase
    → call OpenAI (gpt-4.1-mini) with system prompt + history + tools
    → execute tool calls (save / query / update / delete)
    → save updated state to Supabase
    → return reply text
  → OpenClaw sends reply → WhatsApp → User
```

---

## 3. OpenClaw Configuration Files

### 3.1 SOUL.md

Finn speaks naturally, like a helpful friend who understands finances. Key traits:
- Warm and concise — never robotic or formal
- Bilingual — always responds in the language the user last wrote in (PT-BR or EN)
- Never saves without explicit confirmation
- Proactive about ambiguity — asks one clarifying question at a time, never a form
- Celebrates good financial habits, never judges

### 3.2 AGENTS.md

Instructs OpenClaw to route all WhatsApp messages through the `finance_agent` tool provided by the plugin. No other routing logic needed for v1.

### 3.3 IDENTITY.md

- **Name:** Finn
- **Emoji:** 💰
- **Vibe:** Friendly Brazilian finance buddy

---

## 4. Plugin: finance-agent

### 4.1 Tool registered with OpenClaw

The plugin registers one top-level tool: `finance_agent(phone, message, mediaType?, mediaData?)`.

OpenClaw calls this tool on every incoming WhatsApp message.

### 4.2 agent.ts — The Conversation Loop

```
1. Load conversation_state for this phone from Supabase
2. Append new user message to history
3. Call gpt-4.1-mini with:
   - system_prompt (Finn's instructions, cost centers, categories)
   - full conversation history (last 20 messages)
   - available tools: save_expense, update_expense, delete_expense, query_spending
4. Execute any tool calls the model requests
5. If tool was save_expense → transition state to awaiting_confirm first
6. Return final text response
7. Save updated state + history to Supabase
```

### 4.3 System Prompt

The system prompt includes:
- Finn's personality and language rules
- Fixed cost centers: `Me`, `Lilian`, `Eddie`, `Apto Taman`, `Carro`, `Família`
- Default categories: `Alimentação`, `Supermercado`, `Farmácia`, `Transporte`, `Saúde`, `Lazer`, `Educação`, `Moradia`, `Vestuário`, `Outros`
- State machine rules (never save without confirmation)
- Date/currency handling rules (assume BRL unless stated)

### 4.4 media.ts — Media Processing

| Input | Processing |
|---|---|
| Text | Pass directly to agent |
| Audio (`.ogg`, `.mp3`, `.m4a`) | `openai.audio.transcriptions.create({ model: "whisper-1" })` → transcript → agent |
| Image (`.jpg`, `.png`) | Pass as `image_url` content block to gpt-4.1-mini |
| PDF | `pdf-parse` npm → extract text → agent |

---

## 5. Conversation State Machine

Stored in `conversation_state` table, keyed by phone number.

### States

```
idle
  → expense input detected        → awaiting_confirm
  → edit/delete request           → awaiting_edit_confirm
  → query ("how much this month") → idle (query answered inline)

awaiting_confirm
  → "sim" / "yes" / "👍"          → save_expense → idle
  → "não" / "cancel" / "👎"       → discard → idle
  → correction detected           → update pending_expense → awaiting_confirm
  → new expense                   → overwrite pending → awaiting_confirm
  → query                         → answer inline, stay in awaiting_confirm

awaiting_edit_confirm
  → "sim"                         → apply edit/delete → idle
  → "não"                         → cancel → idle
  → "not that one"                → refine search → awaiting_edit_confirm
```

### Intent Classification

On every message, gpt-4.1-mini classifies intent given the current state:
- In `awaiting_confirm`: is this a confirmation, cancellation, correction, new expense, or query?
- In `idle`: is this an expense log, a query, or an edit request?

The model never guesses — if intent is ambiguous, it asks one short question.

---

## 6. Supabase Schema

### expenses
```sql
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  cost_center TEXT NOT NULL CHECK (cost_center IN ('Me','Lilian','Eddie','Apto Taman','Carro','Família')),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  source      TEXT NOT NULL CHECK (source IN ('text','audio','pdf','image')),
  raw_input   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

### conversation_state
```sql
CREATE TABLE conversation_state (
  phone             TEXT PRIMARY KEY,
  state             TEXT NOT NULL DEFAULT 'idle'
                    CHECK (state IN ('idle','awaiting_confirm','awaiting_edit_confirm')),
  pending_expense   JSONB,
  target_expense_id UUID REFERENCES expenses(id),
  history           JSONB DEFAULT '[]',
  updated_at        TIMESTAMPTZ DEFAULT now()
);
```

---

## 7. OpenAI Model Usage & Costs

| Operation | Model | Estimated cost |
|---|---|---|
| Expense extraction + conversation | gpt-4.1-mini | ~$0.0004 / message |
| Audio transcription | whisper-1 | ~$0.006 / minute |
| Image / receipt OCR | gpt-4.1-mini (vision) | ~$0.001 / image |
| PDF parsing | pdf-parse (local) + gpt-4.1-mini | ~$0.001 / page |
| Spending queries | gpt-4.1-mini | ~$0.0002 / query |

**Estimated daily cost for personal use:** < $0.05/day.

---

## 8. Example Conversations

### Text expense
```
You:   Gastei 20 no almoço
Finn:  R$20 · Alimentação · Me · hoje — confirma? ✅
You:   sim
Finn:  Salvo! 💰 Alimentação já está em R$67 esse mês.
```

### Audio note
```
You:   🎙️ [voice note: "comprei remédio na farmácia, quarenta e cinco reais, é da Lilian"]
Finn:  R$45 · Farmácia · Lilian · hoje — confirma? ✅
You:   sim
Finn:  Anotado! 💊
```

### Correction before confirm
```
You:   Gastei 20 no almoço
Finn:  R$20 · Alimentação · Me · hoje — confirma? ✅
You:   na verdade foi 25
Finn:  Atualizado! R$25 · Alimentação · Me · hoje — agora sim? ✅
You:   sim
Finn:  Salvo! 💰
```

### Edit after saving
```
You:   errei a categoria do supermercado de ontem, é Lilian não eu
Finn:  Encontrei: R$134,50 · Supermercado · Me · 17/04. Atualizo para Lilian?
You:   sim
Finn:  Pronto! ✅ Atualizado para Lilian.
```

### Spending query
```
You:   quanto gastei em Alimentação esse mês?
Finn:  Em Alimentação você gastou R$312,40 em abril (16 registros).
       Maior gasto: R$87,00 em 14/04.
```

### PDF invoice
```
You:   📎 [PDF: fatura cartão abril]
Finn:  Encontrei 23 gastos nessa fatura. Total: R$3.847,20.
       Quer revisar um por um ou salvar todos de uma vez?
You:   salvar todos
Finn:  Salvando... ✅ 23 despesas registradas! 
       Top categorias: Alimentação R$890, Transporte R$430, Saúde R$280.
```

---

## 9. VPS Deployment Steps

```bash
# 1. SSH into VPS
ssh root@vicentejunior.tech

# 2. Install Node 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Install OpenClaw
npm i -g openclaw

# 4. Install PM2
npm i -g pm2

# 5. Connect WhatsApp
openclaw channels login --channel whatsapp
# → scan QR code with your dedicated number

# 6. Configure OpenAI + Supabase keys
openclaw configure
# → set OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

# 7. Install plugin
cd ~/.openclaw/workspace
git clone <this repo> plugins/finance-agent
cd plugins/finance-agent && npm install && npm run build

# 8. Start gateway
pm2 start "openclaw gateway" --name finn
pm2 save && pm2 startup

# 9. nginx + SSL
sudo apt install nginx certbot python3-certbot-nginx
certbot --nginx -d vicentejunior.tech
```

---

## 10. Sprint Plan (8 days)

| Sprint | Days | Focus |
|---|---|---|
| 1 — Foundation | Day 1-2 | VPS setup, OpenClaw install, WhatsApp connected, Supabase schema |
| 2 — Plugin Core | Day 3-4 | Plugin scaffold, OpenAI integration, text expense flow end-to-end |
| 3 — Media + State | Day 5-6 | Audio/image/PDF, full state machine, edit/delete flow |
| 4 — Polish + Submit | Day 7-8 | Queries, SOUL.md polish, testing, DEV.to article |

---

## 11. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| WhatsApp Baileys instability | Medium | Use dedicated number, PM2 auto-restart |
| OpenClaw plugin API changes | Low | Pin openclaw version in package.json |
| gpt-4.1-mini misclassifying intent | Low | Strong system prompt + state-aware context |
| PDF parsing edge cases | Medium | Graceful fallback: ask user to type manually |
| 8-day deadline | High | Cut scope: launch with text + audio only, add PDF/image in day 5-6 |

---

## 12. Out of Scope (v1)

- Multi-user support (single phone number only)
- Budget limits / alerts
- Charts or dashboards
- Other specialist agents (Calendar, Notion) — these are v2
- WhatsApp group support
