-- ==========================================================================
-- Migration 004 — correct a content_hash bug introduced in migration 001
--
-- hash-legal-docs.js's language-block extraction regex assumed the next
-- <div data-lang-content="..."> tag had zero leading indentation. Several
-- legal pages indent it, so the regex silently fell through to a
-- "grab everything until </main>" fallback for the "es" language of all
-- 3 checkout-related documents, hashing ES+EN concatenated instead of ES
-- alone. The document content itself never changed — only the computed
-- hash string was wrong. This is a bug fix, not a new document version:
-- no new legal_documents row, no change to the version number, and
-- existing acceptances are corrected in place (not superseded) because
-- what they actually agreed to — the real v1.0 text — never differed.
--
-- Old (buggy) -> new (correct) hashes:
--   terms:           3ac7af15042b878d117343f887857421d759ccea9f2fe96c7d6f0c4a1dfc2d4a -> b2ab6dd2151c6a8b186f8bbde28a4fb40700e2e9fcbbda8d16ba8f642304cc07
--   privacy:         ed89b1eb2d081d9b94e04ad8784532e874e793908ff6776b5a57bd9706010c4d -> 3aaac81717d2c27c9eddf32eb901694544f058331995d9712e489556c61859a4
--   purchase_policy: 052ce2f15cc24969089e06e9923faeef7c9f09156738f648cb001c5f8ae2b5c0 -> 68be13c9981e93579f7a89429d88298fef58eda1b7261d19a1cf9e58f7c6dc74
--
-- Already applied directly to production via the Cloudflare D1 API during
-- this fix. Kept here for the reproducible-migration record only — do NOT
-- re-run against a database that has already been corrected (the WHERE
-- clauses are historical-value matches, so re-running is a harmless no-op
-- once applied, but there is nothing to gain from running it twice).
-- ==========================================================================

UPDATE legal_documents SET content_hash = 'b2ab6dd2151c6a8b186f8bbde28a4fb40700e2e9fcbbda8d16ba8f642304cc07'
  WHERE document_type = 'terms' AND version = '1.0';
UPDATE legal_documents SET content_hash = '3aaac81717d2c27c9eddf32eb901694544f058331995d9712e489556c61859a4'
  WHERE document_type = 'privacy' AND version = '1.0';
UPDATE legal_documents SET content_hash = '68be13c9981e93579f7a89429d88298fef58eda1b7261d19a1cf9e58f7c6dc74'
  WHERE document_type = 'purchase_policy' AND version = '1.0';

UPDATE checkout_acceptances SET terms_hash = 'b2ab6dd2151c6a8b186f8bbde28a4fb40700e2e9fcbbda8d16ba8f642304cc07'
  WHERE terms_hash = '3ac7af15042b878d117343f887857421d759ccea9f2fe96c7d6f0c4a1dfc2d4a';
UPDATE checkout_acceptances SET privacy_hash = '3aaac81717d2c27c9eddf32eb901694544f058331995d9712e489556c61859a4'
  WHERE privacy_hash = 'ed89b1eb2d081d9b94e04ad8784532e874e793908ff6776b5a57bd9706010c4d';
UPDATE checkout_acceptances SET purchase_policy_hash = '68be13c9981e93579f7a89429d88298fef58eda1b7261d19a1cf9e58f7c6dc74'
  WHERE purchase_policy_hash = '052ce2f15cc24969089e06e9923faeef7c9f09156738f648cb001c5f8ae2b5c0';
