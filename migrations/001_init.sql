-- ============================================================
-- Finn Finance Agent — Migration 001
-- Run once in Supabase SQL Editor
-- After running: Settings → API → Exposed schemas → add "finn"
-- ============================================================

CREATE SCHEMA IF NOT EXISTS finn;

-- ============================================================
-- transactions
-- ============================================================
CREATE TABLE finn.transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'expense'
              CHECK (type IN ('expense','income','card_payment')),
  amount      NUMERIC(10,2) NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  cost_center TEXT NOT NULL CHECK (cost_center IN ('Me','Lilian')),
  card        TEXT CHECK (card IN ('Mastercard','Visa','Aeternum')),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  source      TEXT NOT NULL CHECK (source IN ('text','audio','pdf','image')),
  raw_input   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- categories
-- ============================================================
CREATE TABLE finn.categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO finn.categories (name) VALUES
  ('Food'),('Supermarket'),('Pharmacy'),('Transport'),
  ('Health'),('Entertainment'),('Education'),('Housing'),('Clothing'),('Others');

-- ============================================================
-- credit_cards
-- ============================================================
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

-- ============================================================
-- vocabulary
-- ============================================================
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

-- ============================================================
-- conversation_state
-- ============================================================
CREATE TABLE finn.conversation_state (
  phone                 TEXT PRIMARY KEY,
  state                 TEXT NOT NULL DEFAULT 'idle'
                        CHECK (state IN ('idle','awaiting_confirm','awaiting_edit_confirm')),
  pending_transaction   JSONB,
  target_transaction_id UUID REFERENCES finn.transactions(id),
  history               JSONB DEFAULT '[]',
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS — Enable on all tables
-- service_role key bypasses RLS automatically.
-- No policies = anon/authenticated keys are denied by default.
-- ============================================================
ALTER TABLE finn.transactions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE finn.categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE finn.credit_cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE finn.vocabulary         ENABLE ROW LEVEL SECURITY;
ALTER TABLE finn.conversation_state ENABLE ROW LEVEL SECURITY;
