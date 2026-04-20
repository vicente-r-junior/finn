-- Remove restrictive card CHECK constraint so any account name is accepted
ALTER TABLE finn.transactions DROP CONSTRAINT IF EXISTS transactions_card_check;
