ALTER TABLE finn.transactions ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE finn.transactions ADD COLUMN IF NOT EXISTS billing_cycle text; -- e.g. '2026-04'
