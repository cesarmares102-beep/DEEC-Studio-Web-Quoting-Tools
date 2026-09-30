-- ==========================================================================
-- Migration 003 — record purchase language (Cloudflare D1)
--
-- Non-destructive: only ADD COLUMN (nullable). Needed so the post-payment
-- confirmation email (functions/api/webhooks/whop.js) knows whether to send
-- the Spanish or English version — the checkout already picks a Whop plan
-- per language (see functions/lib/current-terms-version.js) but never
-- stored which language that was until now.
--
-- Apply:
--   wrangler d1 execute deec-studio-quoting-tools-checkout --remote --file=migration-003-checkout-lang.sql
-- ==========================================================================

ALTER TABLE checkout_acceptances ADD COLUMN lang TEXT;
