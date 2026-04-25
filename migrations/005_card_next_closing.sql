-- Add next_closing_date to credit_cards so we store the full date from the PDF
-- ("Previsão prox. Fechamento") rather than just the day number.
-- This lets inferBillingInfo use the exact upcoming closing date instead of
-- guessing from closing_day alone.

ALTER TABLE finn.credit_cards
  ADD COLUMN IF NOT EXISTS next_closing_date DATE;
