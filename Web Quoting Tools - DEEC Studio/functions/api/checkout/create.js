/* ==========================================================================
   POST /api/checkout/create

   Registers a checkout acceptance (client info + terms acceptance) in D1
   BEFORE any Whop checkout exists, and returns what lib/checkout.js needs
   to mount the Whop embedded checkout element:
     { acceptance_id, checkout_reference, plan, product, metadata, return_url }

   This is the server-side "Estado 3: Aceptación registrada" step — nothing
   here talks to Whop. It only creates the record that the checkout
   element's `metadata` will reference, so the payment webhook
   (functions/api/webhooks/whop.js) can later look this row up and mark it
   paid. See functions/lib/current-terms-version.js for the Whop
   checkout-embed API this pairs with (metadata round-trips to the webhook —
   confirmed against https://docs.whop.com/developer/guides/embed-checkout,
   not assumed).

   Price/product protection (spec section 17): the client sends product_id
   only. The real plan id and price come from
   functions/lib/current-terms-version.js's PRODUCTS map + the
   WHOP_PLAN_ID_ES/WHOP_PLAN_ID_EN env vars — never from the request body. Whop enforces the
   actual charge amount for that plan id server-side on its own end, so a
   tampered request body cannot change what gets charged.

   Terms-version protection (spec section 16): the client's claimed
   terms_version must match CURRENT_TERMS_VERSION exactly, or the request
   is rejected with 409 — a client can't invent, downgrade, or backdate a
   version. The server's clock — not anything the client sends — is what
   gets stored as accepted_at.

   Idempotency (spec section 15): `idempotency_key` is generated once per
   page load in lib/checkout.js and sent with every create request from
   that load. A network retry or a second click before the button disables
   reuses the same key: the UNIQUE constraint on idempotency_key means a
   repeat INSERT is rejected, and this handler looks up and returns the
   ORIGINAL row instead of creating a duplicate acceptance.
   ========================================================================== */
import {
  CURRENT_TERMS_VERSION, TERMS_DOCUMENT_NAME, TERMS_URL_PATH, TERMS_CONTENT_HASH,
  CURRENT_PRIVACY_VERSION, PRIVACY_DOCUMENT_NAME, PRIVACY_URL_PATH, PRIVACY_CONTENT_HASH,
  CURRENT_PURCHASE_POLICY_VERSION, PURCHASE_POLICY_DOCUMENT_NAME, PURCHASE_POLICY_URL_PATH, PURCHASE_POLICY_CONTENT_HASH,
  ACCEPTANCE_METHOD,
  resolveProduct
} from "../../lib/current-terms-version.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = new URL(request.url).origin;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }

  const idempotencyKey = cleanString(body.idempotency_key, 100);
  if (!idempotencyKey) return jsonError(400, "missing_idempotency_key", "idempotency_key is required.");
  if (!env.DB) return jsonError(500, "db_not_configured", "D1 database is not bound to this Worker (see wrangler.jsonc).");

  const lang = cleanString(body.lang, 5) === "en" ? "en" : "es";

  // Idempotency check FIRST — a retry with an already-used key returns the
  // existing row untouched instead of re-validating/re-inserting anything.
  const existingRow = await findByIdempotencyKey(env.DB, idempotencyKey);
  if (existingRow) {
    const product = resolveProduct(existingRow.product_id, env, lang);
    if (!product) return jsonError(500, "product_misconfigured", "Product is not configured server-side (missing WHOP_PLAN_ID_ES/WHOP_PLAN_ID_EN?).");
    return jsonOk(buildCreateResponse(origin, existingRow.id, existingRow.checkout_reference, product));
  }

  const customerName = cleanString(body.customer_name, 200);
  const customerEmail = cleanString(body.customer_email, 200).toLowerCase();
  const customerPhone = cleanString(body.customer_phone, 40);
  const businessName = cleanString(body.business_name, 200);
  const country = cleanString(body.country, 100);
  const city = cleanString(body.city, 100);
  const website = cleanString(body.website, 200);
  const productId = cleanString(body.product_id, 60);
  const termsVersion = cleanString(body.terms_version, 20);
  const timezone = cleanString(body.timezone, 60);
  const termsAccepted = body.terms_accepted === true;

  if (!customerName) return jsonError(400, "missing_name", "customer_name is required.");
  if (!customerEmail || !EMAIL_RE.test(customerEmail)) return jsonError(400, "invalid_email", "A valid customer_email is required.");
  if (!customerPhone) return jsonError(400, "missing_phone", "customer_phone is required.");
  if (!businessName) return jsonError(400, "missing_business_name", "business_name is required.");
  if (!country) return jsonError(400, "missing_country", "country is required.");
  if (!city) return jsonError(400, "missing_city", "city is required.");
  if (!termsAccepted) return jsonError(400, "terms_not_accepted", "terms_accepted must be true.");
  // The server is the sole source of truth for which version is current —
  // this is what stops a client from sending a stale or invented version.
  if (termsVersion !== CURRENT_TERMS_VERSION) {
    return jsonError(409, "terms_version_mismatch", "The terms version has changed. Reload the page and accept again.");
  }

  const product = resolveProduct(productId, env, lang);
  if (!product) return jsonError(400, "unknown_product", "Unrecognized product_id, or WHOP_PLAN_ID_ES/WHOP_PLAN_ID_EN is not configured yet.");

  const acceptanceId = "acc_" + crypto.randomUUID();
  const checkoutReference = "chk_" + crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";

  try {
    await env.DB.prepare(
      `INSERT INTO checkout_acceptances (
        id, idempotency_key, customer_name, customer_email, customer_phone,
        business_name, country, city, website, product_id, terms_document, terms_version,
        terms_url, accepted_at, timezone, ip_address, user_agent,
        checkout_reference, payment_reference, status, created_at, updated_at,
        acceptance_method, terms_hash,
        privacy_document, privacy_version, privacy_url, privacy_hash,
        purchase_policy_document, purchase_policy_version, purchase_policy_url, purchase_policy_hash
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'pending_payment',?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      acceptanceId, idempotencyKey, customerName, customerEmail, customerPhone || null,
      businessName || null, country || null, city || null, website || null, productId, TERMS_DOCUMENT_NAME, termsVersion,
      origin + TERMS_URL_PATH, nowIso, timezone || null, ip || null, userAgent || null,
      checkoutReference, nowIso, nowIso,
      // Everything below is 100% server-determined — the client never
      // sends a method, version, url or hash for any of these three
      // documents, so there is nothing here a tampered request could
      // override (spec: "el frontend NO debe poder decidir... versión
      // legal, hash legal").
      ACCEPTANCE_METHOD, TERMS_CONTENT_HASH,
      PRIVACY_DOCUMENT_NAME, CURRENT_PRIVACY_VERSION, origin + PRIVACY_URL_PATH, PRIVACY_CONTENT_HASH,
      PURCHASE_POLICY_DOCUMENT_NAME, CURRENT_PURCHASE_POLICY_VERSION, origin + PURCHASE_POLICY_URL_PATH, PURCHASE_POLICY_CONTENT_HASH
    ).run();
  } catch (err) {
    // A UNIQUE-constraint race (two near-simultaneous requests with the
    // same idempotency key, e.g. a double click that beat the button's
    // disable) — re-read and return whichever row actually won the
    // insert, instead of surfacing a 500 for a case that is really just
    // "already handled".
    const raced = await findByIdempotencyKey(env.DB, idempotencyKey);
    if (raced) {
      const racedProduct = resolveProduct(raced.product_id, env, lang);
      if (racedProduct) return jsonOk(buildCreateResponse(origin, raced.id, raced.checkout_reference, racedProduct));
    }
    console.error("[checkout-create] insert failed: " + err.message);
    return jsonError(500, "db_error", "Could not save the acceptance record.");
  }

  return jsonOk(buildCreateResponse(origin, acceptanceId, checkoutReference, product));
}

export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("method not allowed", { status: 405 });
}

async function findByIdempotencyKey(db, idempotencyKey) {
  try {
    return await db.prepare(
      "SELECT id, checkout_reference, product_id FROM checkout_acceptances WHERE idempotency_key = ?"
    ).bind(idempotencyKey).first();
  } catch (err) {
    return null;
  }
}

function buildCreateResponse(origin, acceptanceId, checkoutReference, product) {
  return {
    acceptance_id: acceptanceId,
    checkout_reference: checkoutReference,
    plan: product.planId,
    product: { name: product.name, price_display: product.priceDisplay },
    metadata: { acceptance_id: acceptanceId, checkout_reference: checkoutReference },
    return_url: origin + "/checkout.html?acceptance=" + encodeURIComponent(acceptanceId)
  };
}

function cleanString(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}
function jsonOk(data) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}
function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: code, message: message }), { status: status, headers: { "content-type": "application/json" } });
}
