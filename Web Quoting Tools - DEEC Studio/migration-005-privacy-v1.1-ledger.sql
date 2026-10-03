-- ==========================================================================
-- Migration 005 — seed the missing privacy-policy v1.1 row in legal_documents
--
-- Found during an integral audit (2026-10-03): lib/legal-versions.js (the
-- frontend) and functions/lib/current-terms-version.js (the backend, which
-- stamps every new checkout acceptance's privacy_version/privacy_hash) have
-- agreed on CURRENT_PRIVACY_VERSION = "1.1" since that document's 2026-09-30
-- rewrite. legal_documents — the standalone audit/reporting ledger seeded by
-- migration-001 — was never updated to match: it still only has a row for
-- privacy 1.0, with no 1.1 entry at all.
--
-- This does NOT affect any individual acceptance's evidence — each row in
-- checkout_acceptances already snapshots its own privacy_version/privacy_url/
-- privacy_hash independently at accept-time (see functions/api/checkout/
-- create.js) and never joins against legal_documents live. This migration
-- only brings the separate ledger table back in sync so a query against it
-- ("what hash did privacy v1.1 have?") has an answer.
--
-- content_hash below was verified immediately before writing this migration
-- by running `node hash-legal-docs.js` (read-only) against the current
-- politica-privacidad.html — output matched
-- functions/lib/current-terms-version.js's PRIVACY_CONTENT_HASH exactly:
--   privacy 1.1 d0fd59178a7eb6982354e254c5535042fb86a5ad21ef7ea48260214da49844ec
--
-- Non-destructive: only an UPDATE (status column, one existing row) and an
-- INSERT OR IGNORE (new row). No DROP, no DELETE, no rebuild. The 1.0 row
-- itself is left fully intact, just marked superseded — same lifecycle
-- migration-001's own header describes ("status flips active->superseded
-- when a newer version is published; the row itself never changes").
--
-- STATUS: already applied directly to production D1 (verified live via the
-- Cloudflare D1 API on 2026-10-03 — ld_privacy_1_1 exists with status
-- 'active', content_hash matches exactly, and ld_privacy_1_0 is already
-- 'superseded'). Same situation as migration-004: someone patched this
-- directly before this file existed. Kept here, like migration-004, for the
-- reproducible-migration record only — both statements are idempotent
-- (UPDATE ... WHERE status='active' / INSERT OR IGNORE) so re-running this
-- file is a harmless no-op, nothing to gain from doing so.
--
-- Apply (only if a fresh/different database ever needs it):
--   wrangler d1 execute deec-studio-quoting-tools-checkout --remote --file=migration-005-privacy-v1.1-ledger.sql
-- ==========================================================================

UPDATE legal_documents SET status = 'superseded'
  WHERE document_type = 'privacy' AND version = '1.0' AND status = 'active';

INSERT OR IGNORE INTO legal_documents (id, document_type, version, title, url, content_hash, published_at, effective_at, status, created_at) VALUES
  ('ld_privacy_1_1', 'privacy', '1.1', 'QuotingTools Privacy Policy', '/politica-privacidad.html', 'd0fd59178a7eb6982354e254c5535042fb86a5ad21ef7ea48260214da49844ec', '2026-09-30T00:00:00.000Z', '2026-09-30T00:00:00.000Z', 'active', '2026-10-03T00:00:00.000Z');
