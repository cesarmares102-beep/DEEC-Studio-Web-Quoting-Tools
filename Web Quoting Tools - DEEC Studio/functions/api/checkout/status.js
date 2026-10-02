/* ==========================================================================
   GET /api/checkout/status?acceptance_id=acc_...

   Returns the SERVER's view of a checkout's status — pending_payment,
   paid, payment_failed, or canceled — as last updated by the payment
   webhook (functions/api/webhooks/whop.js). The frontend never writes
   this value; it only reads it.

   Why this exists: after Whop redirects back to returnUrl, it appends its
   own `?payment=pay_...&status=succeeded|failed|canceled|processing`
   query params. Those are visible in the address bar and could be edited
   by hand, so lib/checkout.js does NOT trust them directly to show "your
   payment succeeded" — it calls this endpoint instead and trusts only
   what D1 says, which only the webhook (triggered by Whop server-to-
   server) can set. See spec section 16: "no permitir que el frontend
   determine unilateralmente que una aceptación ocurrió."
   ========================================================================== */
export async function onRequestGet(context) {
  const { request, env } = context;
  const acceptanceId = new URL(request.url).searchParams.get("acceptance_id") || "";
  if (!acceptanceId) return jsonError(400, "missing_acceptance_id", "acceptance_id query param is required.");
  if (!env.DB) return jsonError(500, "db_not_configured", "D1 database is not bound to this Worker.");

  let row;
  try {
    row = await env.DB.prepare(
      "SELECT status, payment_reference FROM checkout_acceptances WHERE id = ?"
    ).bind(acceptanceId).first();
  } catch (err) {
    return jsonError(500, "db_error", "Could not read acceptance status.");
  }
  if (!row) return jsonError(404, "not_found", "No acceptance found for that id.");

  return new Response(JSON.stringify({ status: row.status, payment_reference: row.payment_reference || null }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

// Cloudflare Pages Functions always calls onRequestGet directly for GET
// requests when it's exported from this file — onRequest below is never
// reached for GET, only for every other method, so it only needs to 405.
export async function onRequest(context) {
  return new Response("method not allowed", { status: 405 });
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: code, message: message }), { status: status, headers: { "content-type": "application/json" } });
}
