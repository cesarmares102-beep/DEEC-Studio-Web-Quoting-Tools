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
    // planId intentionally omitted here — comes from env.WHOP_PLAN_ID
    // (Cloudflare Workers var, see wrangler.jsonc), the same pattern this
    // project already uses for META_DATASET_ID/META_ACCESS_TOKEN: real
    // ids live in Cloudflare's dashboard config, not in source control.
  }
};

/**
 * Resolves a product_id to its full config, including the real Whop plan
 * id pulled from the environment. Returns null if the product_id is not
 * recognized, OR if the plan id hasn't been configured yet — either way,
 * the caller must refuse to create a checkout rather than guess.
 */
export function resolveProduct(productId, env) {
  const product = PRODUCTS[productId];
  if (!product) return null;
  const planId = env && env.WHOP_PLAN_ID;
  if (!planId) return null;
  return Object.assign({}, product, { planId: planId });
}
