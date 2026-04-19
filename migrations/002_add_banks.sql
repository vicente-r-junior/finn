-- Migration 002: Expand card column to include bank accounts
-- Run in Supabase SQL Editor: https://supabase.com/dashboard → SQL Editor

ALTER TABLE finn.transactions
DROP CONSTRAINT IF EXISTS transactions_card_check;

ALTER TABLE finn.transactions
ADD CONSTRAINT transactions_card_check
CHECK (card IN ('Mastercard', 'Visa', 'Aeternum', 'Itaú', 'Bradesco', 'Nu', 'C6'));
