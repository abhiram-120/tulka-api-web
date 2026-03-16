-- Add short_id column to past_due_payments for recovery short URLs
ALTER TABLE past_due_payments
ADD COLUMN short_id VARCHAR(16) NULL COMMENT 'Short identifier used in recovery URLs for this past due payment'
AFTER whatsapp_messages_sent;

-- Optional but recommended: ensure short_id is unique
ALTER TABLE past_due_payments
ADD UNIQUE INDEX idx_past_due_payments_short_id (short_id);


