-- ==========================================================================
-- Migration 002 — add city/website fields to checkout_acceptances (D1)
--
-- Non-destructive: only ADD COLUMN (nullable, no DROP/rebuild). Existing
-- rows get NULL for both — never backfilled with an invented value.
--
-- Apply:
--   wrangler d1 execute deec-studio-quoting-tools-checkout --remote --file=migration-002-checkout-city-website.sql
-- ==========================================================================

ALTER TABLE checkout_acceptances ADD COLUMN city TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN website TEXT;
