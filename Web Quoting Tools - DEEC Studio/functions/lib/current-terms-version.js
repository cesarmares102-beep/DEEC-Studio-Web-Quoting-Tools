/* ==========================================================================
   Server-side mirror of lib/legal-versions.js's "terms-and-conditions"
   entry, plus the checkout's product/plan catalog.

   Workers can't import lib/legal-versions.js directly — it's a browser IIFE
   that writes to `window`, and Workers have no `window` — so this constant
   exists only to give the checkout API (functions/api/checkout/create.js) a
   source of truth to validate the client's claimed terms_version against.
   It does NOT duplicate the legal text itself, only the version tag.

   KEEP IN SYNC BY HAND: whenever lib/legal-versions.js's
   __LEGAL_DOCS__["terms-and-conditions"].currentVersion changes, update
   CURRENT_TERMS_VERSION below in the same commit/publish. This is the one
   place in the project where that number has to be duplicated, because of
   the browser/Worker runtime boundary — everything else about the terms
   (title, history, PDF) still comes only from lib/legal-versions.js.
   ========================================================================== */

export const CURRENT_TERMS_VERSION = "1.0";
export const TERMS_DOCUMENT_NAME = "QuotingTools Terms & Conditions"; // internal label stored on each acceptance row
export const TERMS_URL_PATH = "/terminos-condiciones-compra.html";
export const TERMS_CONTENT_HASH = "b2ab6dd2151c6a8b186f8bbde28a4fb40700e2e9fcbbda8d16ba8f642304cc07";

/* -------------------------------------------------------------
   The checkout's single checkbox ("Acepto los Términos... la Política de
   Privacidad y la Política de Pagos, Cancelaciones y Reembolsos") legally
   covers three documents at once, but only terms_* was ever recorded on
   the acceptance row. These two mirror the same pattern as the terms_*
   constants above, entirely server-side — the client never sends a
   privacy/purchase-policy version or hash, so there is nothing here for a
   tampered request to override. Hashes computed by hash-legal-docs.js (see
   that file's header) over each document's actual body text; re-run it and
   update these + migration/legal_documents whenever a document's content
   changes and a new version is published.
   ------------------------------------------------------------- */
export const CURRENT_PRIVACY_VERSION = "1.1";
export const PRIVACY_DOCUMENT_NAME = "QuotingTools Privacy Policy";
export const PRIVACY_URL_PATH = "/politica-privacidad.html";
export const PRIVACY_CONTENT_HASH = "d0fd59178a7eb6982354e254c5535042fb86a5ad21ef7ea48260214da49844ec";

export const CURRENT_PURCHASE_POLICY_VERSION = "1.0";
export const PURCHASE_POLICY_DOCUMENT_NAME = "QuotingTools Payment, Cancellation and Refund Policy";
export const PURCHASE_POLICY_URL_PATH = "/politica-pagos.html";
export const PURCHASE_POLICY_CONTENT_HASH = "68be13c9981e93579f7a89429d88298fef58eda1b7261d19a1cf9e58f7c6dc74";

// Describes the actual affirmative action that produced the acceptance —
// never recorded just because a page loaded or a checkout was opened.
export const ACCEPTANCE_METHOD = "checkout_checkbox";

/* -------------------------------------------------------------
   Product / plan catalog — the ONLY server-side source of truth for
   price and which Whop plan gets charged. The checkout create endpoint
   accepts only `product_id` from the client and looks everything else up
   here — never trusts a plan id or price sent in the request body. The
   amount actually charged is whatever this plan is configured for in the
   Whop dashboard, so there is no way for a client to substitute a
   different price by editing the request.
   ------------------------------------------------------------- */
const PRODUCTS = {
  "quoting-tool": {
    name: "Cotizador Web Personalizado",
    priceDisplay: "$149.99 USD",
    priceUsd: 149.99
    // planId intentionally omitted here — comes from env.WHOP_PLAN_ID_ES /
    // env.WHOP_PLAN_ID_EN (Cloudflare Workers vars, see wrangler.jsonc),
    // the same pattern this project already uses for
    // META_DATASET_ID/META_ACCESS_TOKEN: real ids live in Cloudflare's
    // dashboard config, not in source control.
    //
    // Two separate Whop plans exist for this one product — Whop's own
    // checkout UI is per-plan, so each language gets its own plan_id even
    // though the underlying product/price is identical:
    //   es → "Cotizador Web Personalizado"
    //   en → "Custom Web Quoter"
  }
};

/**
 * Resolves a product_id to its full config, including the real Whop plan
 * id for the requested language, pulled from the environment. Returns
 * null if the product_id is not recognized, OR if the plan id for that
 * language hasn't been configured yet — either way, the caller must
 * refuse to create a checkout rather than guess or silently fall back to
 * the other language's plan.
 *
 * @param {string} productId
 * @param {object} env
 * @param {string} [lang] - "es" or "en"; anything else (including
 *   omitted) defaults to "es", matching main.js's own detectInitialLang()
 *   default in the frontend.
 */
export function resolveProduct(productId, env, lang) {
  const product = PRODUCTS[productId];
  if (!product) return null;
  var normalizedLang = lang === "en" ? "en" : "es";
  var planId = env && (normalizedLang === "en" ? env.WHOP_PLAN_ID_EN : env.WHOP_PLAN_ID_ES);
  if (!planId) return null;
  return Object.assign({}, product, { planId: planId, lang: normalizedLang });
}
