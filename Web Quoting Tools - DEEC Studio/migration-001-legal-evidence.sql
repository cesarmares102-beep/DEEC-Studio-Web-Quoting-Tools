-- ==========================================================================
-- Migration 001 — legal acceptance evidence hardening (Cloudflare D1)
--
-- Non-destructive: only ADD COLUMN (all nullable, no DROP/ALTER/rebuild) and
-- CREATE TABLE IF NOT EXISTS. Every existing row in checkout_acceptances is
-- preserved untouched; new columns backfill as NULL for historical rows —
-- never invented.
--
-- Apply (from this project's root, wrangler installed/authenticated):
--   wrangler d1 execute deec-studio-quoting-tools-checkout --remote --file=migration-001-legal-evidence.sql
-- ==========================================================================

-- 1. Explicit affirmative-action evidence: HOW the acceptance happened.
--    Never backfilled with a guess for old rows — NULL means "not recorded
--    at the time" (rows created before this migration).
ALTER TABLE checkout_acceptances ADD COLUMN acceptance_method TEXT;

-- 2. Terms document now also carries its content hash (the row already had
--    terms_document/terms_version/terms_url from schema.sql).
ALTER TABLE checkout_acceptances ADD COLUMN terms_hash TEXT;

-- 3. The checkout's single checkbox text covers three documents at once
--    ("Términos y Condiciones... la Política de Privacidad y la Política de
--    Pagos, Cancelaciones y Reembolsos") but only terms_* was ever recorded.
--    These columns close that gap — snapshotted at accept-time, server-side,
--    same pattern as terms_*.
ALTER TABLE checkout_acceptances ADD COLUMN privacy_document TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN privacy_version TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN privacy_url TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN privacy_hash TEXT;

ALTER TABLE checkout_acceptances ADD COLUMN purchase_policy_document TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN purchase_policy_version TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN purchase_policy_url TEXT;
ALTER TABLE checkout_acceptances ADD COLUMN purchase_policy_hash TEXT;

-- 4. Source-of-truth ledger for legal document versions/hashes. Rows here
--    are never updated once inserted (status flips active->superseded when
--    a newer version is published; the row itself never changes) — a
--    historical acceptance's snapshot columns above never join against this
--    table live, so a later publish here can never alter past evidence.
CREATE TABLE IF NOT EXISTS legal_documents (
  id            TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,     -- terms | privacy | purchase_policy
  version       TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  content_hash  TEXT NOT NULL,     -- sha256 hex, see hash-legal-docs.js
  published_at  TEXT NOT NULL,
  effective_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | superseded
  created_at    TEXT NOT NULL,
  UNIQUE(document_type, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_documents_type_status ON legal_documents(document_type, status);

-- 5. Seed the 3 documents' current (v1.0) versions — audit/reporting ledger
--    only; functions/lib/current-terms-version.js is what the checkout API
--    actually reads at request time (see that file's header for why the
--    Worker runtime can't import lib/legal-versions.js directly).
INSERT OR IGNORE INTO legal_documents (id, document_type, version, title, url, content_hash, published_at, effective_at, status, created_at) VALUES
  ('ld_terms_1_0', 'terms', '1.0', 'QuotingTools Terms & Conditions', '/terminos-condiciones-compra.html', '3ac7af15042b878d117343f887857421d759ccea9f2fe96c7d6f0c4a1dfc2d4a', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', 'active', '2026-09-30T00:00:00.000Z'),
  ('ld_privacy_1_0', 'privacy', '1.0', 'QuotingTools Privacy Policy', '/politica-privacidad.html', 'ed89b1eb2d081d9b94e04ad8784532e874e793908ff6776b5a57bd9706010c4d', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', 'active', '2026-09-30T00:00:00.000Z'),
  ('ld_purchase_policy_1_0', 'purchase_policy', '1.0', 'QuotingTools Payment, Cancellation and Refund Policy', '/politica-pagos.html', '052ce2f15cc24969089e06e9923faeef7c9f09156738f648cb001c5f8ae2b5c0', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z', 'active', '2026-09-30T00:00:00.000Z');
