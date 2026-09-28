/* ==========================================================================
   Whop → Meta Conversions API bridge.

   Receives `payment.succeeded` webhooks from Whop, verifies their
   signature (Standard Webhooks spec), and forwards a server-side
   "Purchase" event to Meta Conversions API — exactly once per payment,
   deduped via Cloudflare KV keyed on the payment id (pay_...).

   This is the ONLY place Purchase is ever sent to Meta. The frontend
   (index.html/main.js) intentionally only sends PageView and Contact (fired
   on every WhatsApp CTA click) — see the comments there. There's no
   on-site checkout anymore (every CTA opens a WhatsApp chat instead —
   see main.js's initWhatsapp()); this webhook only matters if a sale is
   later closed through a Whop payment link shared in that conversation,
   in which case Whop still calls it asynchronously once the buyer
   finishes paying.

   Field mapping below was confirmed directly by Whop support for this
   integration — not assumed from generic docs:
     Purchase.value    = data.settlement_amount
     Purchase.currency = data.currency.toUpperCase()
     event_id          = data.id (pay_...)
     event_time        = data.paid_at, converted to unix seconds
     user_data.em      = SHA-256(data.user.email, normalized), only if present

   Required environment bindings (Cloudflare Workers → Settings):
     WHOP_WEBHOOK_SECRET   — secret, the "ws_..." value from Whop's webhook config
     META_DATASET_ID       — plain variable (mirrored in wrangler.jsonc "vars"), the Meta dataset id
     META_ACCESS_TOKEN     — secret, Conversions API system-user token
     WHOP_PURCHASES        — KV namespace binding (declared in wrangler.jsonc), dedup store keyed on pay_...
   ========================================================================== */

const META_API_VERSION = "v21.0";
const SIGNATURE_MAX_AGE_SECONDS = 5 * 60; // Whop: reject anything older than 5 minutes
const DEDUPE_TTL_SECONDS = 60 * 60 * 24 * 90; // comfortably longer than Whop's ~71h retry window

export async function onRequestPost(context) {
  const { request, env } = context;

  // Signature verification needs the exact raw bytes Whop signed — must
  // read the body as text BEFORE any JSON.parse, or the signature check
  // will never match (confirmed in Whop's own docs: "Parsing it first
  // changes the bytes and the signature check fails").
  const rawBody = await request.text();

  const verification = await verifyWhopSignature(request, rawBody, env.WHOP_WEBHOOK_SECRET);
  if (!verification.ok) {
    // Log only a generic reason — never the signature/secret values.
    console.warn("[whop-webhook] rejected: " + verification.reason);
    return new Response("invalid signature", { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return new Response("invalid JSON", { status: 400 });
  }

  if (event.type !== "payment.succeeded") {
    // Acknowledge and ignore — lets this same webhook subscription cover
    // other event types later without this handler choking on them.
    return new Response("ignored (not payment.succeeded)", { status: 200 });
  }

  const payment = event.data;
  if (!payment || !payment.id) {
    return new Response("missing data.id", { status: 400 });
  }
  if (payment.settlement_amount == null || !payment.currency) {
    // Malformed/unexpected payload shape — don't guess a value, don't
    // retry-loop forever on something that'll never fix itself. Surface
    // it loudly instead.
    console.error("[whop-webhook] payment " + payment.id + " missing settlement_amount/currency");
    return new Response("payload missing required fields", { status: 400 });
  }

  const dedupeKey = "processed:" + payment.id;
  const alreadyProcessed = await env.WHOP_PURCHASES.get(dedupeKey);
  if (alreadyProcessed) {
    return new Response("already processed", { status: 200 });
  }

  let metaResult;
  try {
    metaResult = await sendPurchaseToMeta(payment, env);
  } catch (err) {
    console.error("[whop-webhook] Meta CAPI call threw for " + payment.id + ": " + err.message);
    // Non-2xx so Whop retries later on its own backoff schedule — pay_...
    // was never marked as processed, so the retry cleanly tries Meta again.
    return new Response("upstream error, retry later", { status: 502 });
  }

  if (!metaResult.ok) {
    console.error(
      "[whop-webhook] Meta CAPI rejected " + payment.id + ": " + metaResult.status + " " + metaResult.bodyText
    );
    return new Response("meta rejected event, retry later", { status: 502 });
  }

  // Only mark as processed once Meta has actually accepted the event —
  // if we marked it earlier and the Meta call then failed, a legitimate
  // Whop retry would be silently swallowed as "already processed" and
  // the Purchase would never make it to Meta at all.
  await env.WHOP_PURCHASES.put(dedupeKey, "1", { expirationTtl: DEDUPE_TTL_SECONDS });

  return new Response("ok", { status: 200 });
}

// Anything other than a signed POST shouldn't do anything — e.g. someone
// opening this URL in a browser.
export async function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return new Response("method not allowed", { status: 405 });
}

async function verifyWhopSignature(request, rawBody, secret) {
  if (!secret) return { ok: false, reason: "WHOP_WEBHOOK_SECRET not configured" };

  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signatureHeader = request.headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) {
    return { ok: false, reason: "missing signature headers" };
  }

  const ts = parseInt(timestamp, 10);
  if (!ts || Math.abs(Math.floor(Date.now() / 1000) - ts) > SIGNATURE_MAX_AGE_SECONDS) {
    return { ok: false, reason: "timestamp outside allowed window" };
  }

  const signedContent = id + "." + timestamp + "." + rawBody;

  // Whop's own docs explicitly warn: use the "ws_..." secret's raw bytes
  // directly as the HMAC key — do NOT strip the prefix or base64-decode
  // it. That stripping/decoding step is the generic Standard Webhooks
  // convention (whsec_... secrets), but Whop deviates from it on purpose
  // and calls out getting this wrong as a common mistake.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expectedSignature = base64Encode(new Uint8Array(signatureBytes));

  // webhook-signature can carry multiple space-separated "v1,<sig>" values
  // (during secret rotation) — accept a match against any of them.
  const candidates = signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean);

  const matched = candidates.some((candidate) => timingSafeEqual(candidate, expectedSignature));
  if (!matched) return { ok: false, reason: "signature mismatch" };

  return { ok: true };
}

function base64Encode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Constant-time string comparison — a plain === here would let an
// attacker infer the correct signature one byte at a time by measuring
// response timing.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendPurchaseToMeta(payment, env) {
  const eventTimeSeconds = payment.paid_at
    ? Math.floor(new Date(payment.paid_at).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  const userData = {};
  const email = payment.user && payment.user.email;
  if (email) {
    userData.em = [await sha256Hex(email.trim().toLowerCase())];
  }

  const body = {
    data: [
      {
        event_name: "Purchase",
        event_time: eventTimeSeconds,
        event_id: payment.id,
        action_source: "website",
        user_data: userData,
        custom_data: {
          value: payment.settlement_amount,
          currency: payment.currency.toUpperCase(),
        },
      },
    ],
  };

  // Optional, env-driven only — never hardcoded. Set META_TEST_EVENT_CODE
  // in Cloudflare (Settings → Variables) while testing against Meta's
  // "Test Events" tab so sandbox/test purchases don't land in real
  // campaign attribution data; delete that one variable afterward to
  // stop tagging events as test — no code change or redeploy needed
  // either way.
  if (env.META_TEST_EVENT_CODE) {
    body.test_event_code = env.META_TEST_EVENT_CODE;
  }

  const url =
    "https://graph.facebook.com/" +
    META_API_VERSION +
    "/" +
    env.META_DATASET_ID +
    "/events?access_token=" +
    encodeURIComponent(env.META_ACCESS_TOKEN);

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const bodyText = await res.text();
  return { ok: res.ok, status: res.status, bodyText };
}
