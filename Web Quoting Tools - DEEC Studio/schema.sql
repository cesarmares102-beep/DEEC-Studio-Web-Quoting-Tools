-- ==========================================================================
-- DEEC Studio — checkout acceptance ledger (Cloudflare D1)
--
-- Setup (one time, from this project's root, with wrangler installed and
-- authenticated to the right Cloudflare account):
--
--   1. wrangler d1 create deec-studio-quoting-tools-checkout
--      -> copy the "database_id" it prints
--   2. Paste that id into wrangler.jsonc's d1_databases[0].database_id
--      (it currently has a REPLACE_WITH_REAL_D1_DATABASE_ID placeholder)
--   3. wrangler d1 execute deec-studio-quoting-tools-checkout --remote --file=schema.sql
--      (drop --remote to apply to the local dev database instead)
--   4. Apply migration-001-legal-evidence.sql through migration-004-fix-
--      legal-hash-bug.sql, in that numeric order. This file is the original
--      v1 table only — it does NOT include the city/website/lang columns
--      or the terms_hash/privacy_*/purchase_policy_* legal-evidence columns
--      functions/api/checkout/create.js actually inserts into today, nor
--      the legal_documents table migration-001 creates. A fresh database
--      needs schema.sql AND every migration to match production.
--
-- Every row here is written by functions/api/checkout/create.js (insert,
-- status='pending_payment') and later updated by functions/api/webhooks/
-- whop.js (status='paid' + payment_reference, once Whop confirms payment).
-- The frontend never writes to this table directly.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS checkout_acceptances (
  id                  TEXT PRIMARY KEY,        -- acceptance_id, "acc_<uuid>"
  idempotency_key     TEXT NOT NULL UNIQUE,    -- generated once per page load by lib/checkout.js; a retry with the same key reuses this row instead of creating a duplicate
  customer_name       TEXT NOT NULL,
  customer_email      TEXT NOT NULL,
  customer_phone      TEXT,
  business_name       TEXT,
  country             TEXT,
  product_id          TEXT NOT NULL,
  terms_document      TEXT NOT NULL,
  terms_version       TEXT NOT NULL,
  terms_url           TEXT NOT NULL,
  accepted_at         TEXT NOT NULL,           -- ISO 8601, server clock — never trusts a client-supplied timestamp
  timezone            TEXT,                    -- client-reported (Intl.DateTimeFormat), informational only
  ip_address          TEXT,                    -- from CF-Connecting-IP
  user_agent          TEXT,
  checkout_reference  TEXT NOT NULL UNIQUE,    -- "chk_<uuid>", sent to Whop as metadata.checkout_reference
  payment_reference   TEXT,                    -- Whop's "pay_..." id — NULL until the webhook confirms payment
  status              TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid | payment_failed | canceled
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkout_acceptances_email  ON checkout_acceptances(customer_email);
CREATE INDEX IF NOT EXISTS idx_checkout_acceptances_status ON checkout_acceptances(status);
