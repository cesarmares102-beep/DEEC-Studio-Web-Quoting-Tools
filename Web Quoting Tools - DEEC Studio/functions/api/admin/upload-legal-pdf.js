/* ==========================================================================
   POST /api/admin/upload-legal-pdf?key=<type>-<version>-<lang>.pdf

   One-time/occasional admin endpoint: writes a single official legal PDF
   (generated locally by generate-legal-pdfs.js) into the LEGAL_DOCS R2
   bucket. Not linked from anywhere in the UI — called by hand (curl) after
   generating a new PDF, and only when a document version is first
   published or regenerated.

   Security: requires header "x-admin-secret: <ADMIN_UPLOAD_SECRET>",
   compared in constant time (same pattern as the Whop webhook's signature
   check). Without that secret configured, this endpoint refuses every
   request — it does not silently no-op like the optional email sending
   does, because unlike a missing feature, an unauthenticated write
   endpoint left wide open would be a real vulnerability.

   Required environment binding (Cloudflare Workers → Settings):
     ADMIN_UPLOAD_SECRET — secret, any long random string you choose
     LEGAL_DOCS           — R2 bucket binding (declared in wrangler.jsonc)
   ========================================================================== */

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ADMIN_UPLOAD_SECRET) return new Response("admin uploads not configured", { status: 503 });

  const provided = request.headers.get("x-admin-secret") || "";
  if (!provided || !timingSafeEqual(provided, env.ADMIN_UPLOAD_SECRET)) {
    return new Response("unauthorized", { status: 401 });
  }

  if (!env.LEGAL_DOCS) return new Response("R2 not configured", { status: 500 });

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  // Only ever "<type>-<version>-<lang>.pdf" — refuses anything that could
  // be used to write outside the expected flat key namespace.
  if (!/^[a-z_]+-[0-9]+(\.[0-9]+)*-(es|en)\.pdf$/.test(key)) {
    return new Response("invalid key", { status: 400 });
  }

  const contentType = request.headers.get("content-type") || "application/pdf";
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) return new Response("empty body", { status: 400 });

  await env.LEGAL_DOCS.put(key, body, {
    httpMetadata: { contentType: "application/pdf" }
  });

  return new Response(JSON.stringify({ ok: true, key: key, bytes: body.byteLength, contentTypeReceived: contentType }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

// Cloudflare Pages Functions always calls onRequestPost directly for POST
// requests when it's exported from this file — onRequest below is never
// reached for POST, only for every other method, so it only needs to 405.
export async function onRequest(context) {
  return new Response("method not allowed", { status: 405 });
}
