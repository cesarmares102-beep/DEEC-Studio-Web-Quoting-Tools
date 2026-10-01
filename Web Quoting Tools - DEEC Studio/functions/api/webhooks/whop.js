/* ==========================================================================
   Whop → Meta Conversions API bridge.

   Receives `payment.succeeded` webhooks from Whop, verifies their
   signature (Standard Webhooks spec), and forwards a server-side
   "Purchase" event to Meta Conversions API — exactly once per payment,
   deduped via Cloudflare KV keyed on the payment id (pay_...).

   This is the ONLY place Purchase is ever sent to Meta. The main site's
   WhatsApp CTAs (main.js's initWhatsapp()) are a separate, earlier-funnel
   path — a sale closed through a Whop payment link shared in that
   conversation still calls this same webhook. The primary path today is
   checkout.html's embedded Whop checkout (see lib/checkout.js and
   functions/api/checkout/create.js), whose `metadata.acceptance_id`
   round-trips back here — see updateAcceptanceIfPresent() below, which is
   also where the post-payment confirmation email is sent from.

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
     DB                    — D1 binding (declared in wrangler.jsonc), checkout_acceptances table
     RESEND_API_KEY        — secret, from resend.com — required to send the post-payment
                              confirmation email (see sendConfirmationEmail below). If unset,
                              email sending is skipped (logged, non-fatal) — Purchase still
                              reaches Meta either way.
     RESEND_FROM_EMAIL     — plain variable, e.g. "DEEC Studio <compras@deecstudio-quotingtools.online>".
                              Must be on a domain verified in Resend. Defaults to a placeholder
                              that will fail Resend's own validation if never configured.
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

  // Best-effort, additive only: if this payment came from the
  // checkout.html flow, its metadata carries acceptance_id (set in
  // functions/api/checkout/create.js, round-tripped through Whop's
  // `metadata` — confirmed against docs.whop.com/developer/guides/
  // embed-checkout, not assumed). Not every payment has this — e.g. a
  // bare Whop link shared manually in a WhatsApp chat, with no
  // checkout.html step involved — so its absence is normal, not an
  // error. A D1 failure here must never undo the Meta CAPI success above
  // or make Whop retry a webhook that already did its critical job,
  // which is why it's a separate try/catch after the point of no return.
  await updateAcceptanceIfPresent(payment, env);

  return new Response("ok", { status: 200 });
}

async function updateAcceptanceIfPresent(payment, env) {
  const acceptanceId = payment.metadata && payment.metadata.acceptance_id;
  if (!acceptanceId || !env.DB) return;

  let row;
  try {
    await env.DB.prepare(
      "UPDATE checkout_acceptances SET status = 'paid', payment_reference = ?, updated_at = ? WHERE id = ?"
    ).bind(payment.id, new Date().toISOString(), acceptanceId).run();

    // Re-read the row we just updated — the confirmation email needs the
    // customer/business info and the legal document versions/urls that
    // were snapshotted at accept-time (see functions/api/checkout/create.js),
    // so the email always reflects what was actually agreed to at purchase
    // time, never whatever the legal docs say today.
    row = await env.DB.prepare(
      `SELECT customer_name, customer_email, business_name, lang,
              terms_version, terms_url, privacy_version, privacy_url,
              purchase_policy_version, purchase_policy_url
       FROM checkout_acceptances WHERE id = ?`
    ).bind(acceptanceId).first();
  } catch (err) {
    console.error("[whop-webhook] D1 acceptance update failed (non-fatal): " + err.message);
    return;
  }

  if (row) await sendConfirmationEmail(row, payment, env);
}

/* -------------------------------------------------------------
   Post-payment confirmation email — best-effort, non-fatal (a failure
   here never undoes the Meta CAPI success or the D1 "paid" update above,
   and never makes Whop retry the webhook). Sent exactly once per payment
   because this whole handler already returns early for a payment.id it's
   seen before (see the KV dedupe check in onRequestPost) — there's no
   separate dedupe needed just for the email.

   Per spec: this is EMAIL 1 (purchase confirmation + legal documents).
   EMAIL 2 (configuration questionnaire) is intentionally NOT implemented
   yet — the questionnaire itself doesn't exist yet on the business side.
   ------------------------------------------------------------- */
const RESEND_API_URL = "https://api.resend.com/emails";

const EMAIL_COPY = {
  es: {
    subject: "Tu Cotizador Web de DEEC Studio — Compra confirmada",
    heading: "Compra confirmada",
    intro: "Gracias por tu compra. Aquí tienes el resumen y los siguientes pasos.",
    fields: { customer: "Cliente", business: "Negocio", product: "Producto", date: "Fecha de compra", amount: "Monto pagado", status: "Estado del pago" },
    statusPaid: "Pagado",
    includesTitle: "TU COMPRA INCLUYE",
    includes: [
      "Cotizador web personalizado", "Branding e información de tu negocio", "Tus servicios o productos configurados",
      "Tus precios configurados", "Tus reglas de cobro configuradas", "Entrega en hasta 24 horas",
      "Entrega digital o instalación opcional", "Acompañamiento de implementación"
    ],
    benefitsTitle: "BENEFICIOS DE COMPRA",
    benefits: ["Pago único", "Sin suscripciones ni pagos recurrentes", "Sin renovación ni mantenimiento recurrente", "Acceso permanente a tu cotizador web"],
    notIncludedTitle: "NO INCLUYE",
    notIncluded: ["Hosting ni dominio", "Licencias o herramientas de terceros", "Nuevas funciones o cambios de lógica dentro del cotizador"],
    legalTitle: "DOCUMENTOS LEGALES APLICABLES A ESTA COMPRA",
    legalDocs: { terms: "Términos y Condiciones de Compra", privacy: "Política de Privacidad", purchasePolicy: "Política de Pagos, Cancelaciones y Reembolsos" },
    downloadPdf: "Descargar PDF →",
    viewOnline: "Ver documento",
    versionLabel: "versión"
  },
  en: {
    subject: "Your DEEC Studio Quoting Tool — Purchase Confirmed",
    heading: "Purchase confirmed",
    intro: "Thank you for your purchase. Here's your summary and next steps.",
    fields: { customer: "Customer", business: "Business", product: "Product", date: "Purchase date", amount: "Amount paid", status: "Payment status" },
    statusPaid: "Paid",
    includesTitle: "YOUR PURCHASE INCLUDES",
    includes: [
      "Custom web quoting tool", "Your business branding and information", "Your services or products configured",
      "Your prices configured", "Your billing rules configured", "Delivery within 24 hours",
      "Digital delivery or optional installation", "Implementation assistance"
    ],
    benefitsTitle: "PURCHASE BENEFITS",
    benefits: ["One-time payment", "No subscriptions or recurring payments", "No renewal or recurring maintenance", "Permanent access to your delivered quoting tool"],
    notIncludedTitle: "NOT INCLUDED",
    notIncluded: ["Hosting or domain", "Third-party licenses or tools", "New features or logic changes within the quoting tool"],
    legalTitle: "LEGAL DOCUMENTS APPLICABLE TO THIS PURCHASE",
    legalDocs: { terms: "Terms and Conditions of Purchase", privacy: "Privacy Policy", purchasePolicy: "Payment, Cancellation and Refund Policy" },
    downloadPdf: "Download PDF →",
    viewOnline: "View document",
    versionLabel: "version"
  }
};

function escapeEmailHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

function buildConfirmationEmailHtml(row, payment, copy, lang) {
  const li = function (items) { return items.map(function (i) { return "<li style=\"margin:0 0 6px;\">" + escapeEmailHtml(i) + "</li>"; }).join(""); };
  const amount = (payment.settlement_amount != null ? payment.settlement_amount.toFixed(2) : "—") + " " + (payment.currency || "").toUpperCase();
  const purchaseDate = payment.paid_at ? new Date(payment.paid_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  // terms_url was stored at accept-time as origin + TERMS_URL_PATH (see
  // functions/api/checkout/create.js) — reusing that same origin here
  // means the PDF link always points at the same environment the buyer
  // actually purchased from, without needing the original request.
  const origin = (function () { try { return new URL(row.terms_url).origin; } catch (e) { return ""; } })();

  // pdfType matches generate-legal-pdfs.js's DOCS[].type and the R2 key
  // prefix served by functions/api/legal-pdf/[filename].js — NOT the same
  // string as legal_documents.document_type in every case, but it is here
  // (terms/privacy/purchase_policy all line up 1:1).
  const legalRow = function (label, version, url, pdfType) {
    const pdfUrl = origin + "/api/legal-pdf/" + pdfType + "-" + lang + ".pdf";
    return (
      "<tr><td style=\"padding:10px 0;border-top:1px solid #e5e7eb;\">" +
      "<div style=\"font-weight:600;\">" + escapeEmailHtml(label) + " <span style=\"font-weight:400;color:#6b7280;\">(" + copy.versionLabel + " " + escapeEmailHtml(version || "—") + ")</span></div>" +
      "<a href=\"" + escapeEmailHtml(pdfUrl) + "\" style=\"color:#3f6b3f;text-decoration:underline;font-weight:600;\">" + copy.downloadPdf + "</a>" +
      " &nbsp;·&nbsp; " +
      "<a href=\"" + escapeEmailHtml(url) + "\" style=\"color:#6b7280;text-decoration:underline;\">" + copy.viewOnline + "</a>" +
      "</td></tr>"
    );
  };

  return (
    "<div style=\"font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827;\">" +
    // SVG renders in Gmail/Apple Mail; Outlook desktop (Word rendering
    // engine) shows a broken image instead — no PNG asset exists yet to
    // cover that client too. width/height attributes (not just CSS) are
    // load-bearing in email: several clients ignore <style> entirely.
    "<img src=\"" + origin + "/assets/logo-deecstudio.svg\" alt=\"DEEC Studio\" width=\"132\" height=\"28\" style=\"display:block;margin:0 0 20px;\" />" +
    "<h1 style=\"font-size:22px;margin:0 0 4px;\">" + copy.heading + "</h1>" +
    "<p style=\"color:#6b7280;margin:0 0 20px;\">" + copy.intro + "</p>" +
    "<table style=\"width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;\">" +
    "<tr><td style=\"padding:4px 0;color:#6b7280;\">" + copy.fields.customer + "</td><td style=\"padding:4px 0;text-align:right;\">" + escapeEmailHtml(row.customer_name) + "</td></tr>" +
    (row.business_name ? "<tr><td style=\"padding:4px 0;color:#6b7280;\">" + copy.fields.business + "</td><td style=\"padding:4px 0;text-align:right;\">" + escapeEmailHtml(row.business_name) + "</td></tr>" : "") +
    "<tr><td style=\"padding:4px 0;color:#6b7280;\">" + copy.fields.product + "</td><td style=\"padding:4px 0;text-align:right;\">Cotizador Web Personalizado</td></tr>" +
    "<tr><td style=\"padding:4px 0;color:#6b7280;\">" + copy.fields.date + "</td><td style=\"padding:4px 0;text-align:right;\">" + purchaseDate + "</td></tr>" +
    "<tr><td style=\"padding:4px 0;color:#6b7280;\">" + copy.fields.amount + "</td><td style=\"padding:4px 0;text-align:right;\">" + amount + "</td></tr>" +
    "<tr><td style=\"padding:4px 0;color:#6b7280;\">" + copy.fields.status + "</td><td style=\"padding:4px 0;text-align:right;\">" + copy.statusPaid + "</td></tr>" +
    "</table>" +
    "<h2 style=\"font-size:13px;letter-spacing:.06em;color:#6b7280;margin:24px 0 8px;\">" + copy.includesTitle + "</h2>" +
    "<ul style=\"margin:0;padding-left:18px;font-size:14px;\">" + li(copy.includes) + "</ul>" +
    "<h2 style=\"font-size:13px;letter-spacing:.06em;color:#6b7280;margin:24px 0 8px;\">" + copy.benefitsTitle + "</h2>" +
    "<ul style=\"margin:0;padding-left:18px;font-size:14px;\">" + li(copy.benefits) + "</ul>" +
    "<h2 style=\"font-size:13px;letter-spacing:.06em;color:#6b7280;margin:24px 0 8px;\">" + copy.notIncludedTitle + "</h2>" +
    "<ul style=\"margin:0;padding-left:18px;font-size:14px;color:#6b7280;\">" + li(copy.notIncluded) + "</ul>" +
    "<h2 style=\"font-size:13px;letter-spacing:.06em;color:#6b7280;margin:28px 0 4px;\">" + copy.legalTitle + "</h2>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:14px;\">" +
    legalRow(copy.legalDocs.terms, row.terms_version, row.terms_url, "terms") +
    legalRow(copy.legalDocs.privacy, row.privacy_version, row.privacy_url, "privacy") +
    legalRow(copy.legalDocs.purchasePolicy, row.purchase_policy_version, row.purchase_policy_url, "purchase_policy") +
    "</table>" +
    "<p style=\"color:#9ca3af;font-size:12px;margin-top:32px;\">Deec Studio · deecstudio-quotingtools.online</p>" +
    "</div>"
  );
}

// Plain-text alternative, sent alongside the HTML in the same Resend call
// (multipart). Spam filters weigh an HTML-only email, with no text/plain
// part, as a real signal — this isn't cosmetic, it measurably affects
// inbox placement. Content mirrors the HTML version; no new copy, just a
// non-HTML rendering of the same facts.
function buildConfirmationEmailText(row, payment, copy, lang) {
  const amount = (payment.settlement_amount != null ? payment.settlement_amount.toFixed(2) : "—") + " " + (payment.currency || "").toUpperCase();
  const purchaseDate = payment.paid_at ? new Date(payment.paid_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const origin = (function () { try { return new URL(row.terms_url).origin; } catch (e) { return ""; } })();
  const bullet = function (items) { return items.map(function (i) { return "- " + i; }).join("\n"); };
  const legalLine = function (label, version, pdfType) {
    return label + " (" + copy.versionLabel + " " + (version || "—") + "): " + origin + "/api/legal-pdf/" + pdfType + "-" + lang + ".pdf";
  };

  return (
    copy.heading + "\n" + copy.intro + "\n\n" +
    copy.fields.customer + ": " + row.customer_name + "\n" +
    (row.business_name ? copy.fields.business + ": " + row.business_name + "\n" : "") +
    copy.fields.product + ": Cotizador Web Personalizado\n" +
    copy.fields.date + ": " + purchaseDate + "\n" +
    copy.fields.amount + ": " + amount + "\n" +
    copy.fields.status + ": " + copy.statusPaid + "\n\n" +
    copy.includesTitle + "\n" + bullet(copy.includes) + "\n\n" +
    copy.benefitsTitle + "\n" + bullet(copy.benefits) + "\n\n" +
    copy.notIncludedTitle + "\n" + bullet(copy.notIncluded) + "\n\n" +
    copy.legalTitle + "\n" +
    legalLine(copy.legalDocs.terms, row.terms_version, "terms") + "\n" +
    legalLine(copy.legalDocs.privacy, row.privacy_version, "privacy") + "\n" +
    legalLine(copy.legalDocs.purchasePolicy, row.purchase_policy_version, "purchase_policy") + "\n\n" +
    "Deec Studio · deecstudio-quotingtools.online"
  );
}

async function sendConfirmationEmail(row, payment, env) {
  try {
    if (!env.RESEND_API_KEY) {
      console.warn("[whop-webhook] RESEND_API_KEY not configured — skipping confirmation email");
      return;
    }
    if (!row.customer_email) return;

    const lang = row.lang === "en" ? "en" : "es";
    const copy = EMAIL_COPY[lang];
    const html = buildConfirmationEmailHtml(row, payment, copy, lang);
    const text = buildConfirmationEmailText(row, payment, copy, lang);

    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + env.RESEND_API_KEY
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL || "DEEC Studio <onboarding@resend.dev>",
        to: [row.customer_email],
        text: text,
        subject: copy.subject,
        html: html
      })
    });

    if (!res.ok) {
      const bodyText = await res.text();
      console.error("[whop-webhook] Resend rejected confirmation email: " + res.status + " " + bodyText);
    }
  } catch (err) {
    console.error("[whop-webhook] confirmation email failed (non-fatal): " + err.message);
  }
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
