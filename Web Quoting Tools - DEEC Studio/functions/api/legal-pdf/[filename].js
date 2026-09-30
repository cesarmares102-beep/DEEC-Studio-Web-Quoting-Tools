/* ==========================================================================
   GET /api/legal-pdf/<type>-<lang>.pdf

   Serves the ONE official PDF for a legal document, straight from R2 — the
   same file used by: (1) the legal page's "Download PDF" button, and (2)
   the post-payment confirmation email (see functions/api/webhooks/whop.js).
   Never generated on the fly, never different per request.

   R2 object keys are "<type>-<version>-<lang>.pdf" (see
   generate-legal-pdfs.js), e.g. "terms-1.0-es.pdf". The public URL omits
   the version on purpose — /api/legal-pdf/terms-es.pdf always resolves to
   whichever version is CURRENT (looked up from
   functions/lib/current-terms-version.js), so old emails/links never need
   rewriting when a new version is published. A stale/expired link just
   means the buyer re-reads under a newer version, which the buyer's own
   acceptance row (checkout_acceptances) — not this URL — is what records
   which version they actually agreed to.
   ========================================================================== */
import {
  CURRENT_TERMS_VERSION,
  CURRENT_PRIVACY_VERSION,
  CURRENT_PURCHASE_POLICY_VERSION
} from "../../lib/current-terms-version.js";

const CURRENT_VERSION_BY_TYPE = {
  terms: CURRENT_TERMS_VERSION,
  privacy: CURRENT_PRIVACY_VERSION,
  purchase_policy: CURRENT_PURCHASE_POLICY_VERSION
};

export async function onRequestGet(context) {
  const { params, env } = context;
  const filename = String(params.filename || "");

  // "<type>-<lang>.pdf" — type may itself contain a hyphen
  // (purchase_policy), so match from the right: lang is always the last
  // hyphen-separated segment before ".pdf".
  const m = filename.match(/^([a-z_]+)-(es|en)\.pdf$/);
  if (!m) return new Response("not found", { status: 404 });

  const [, type, lang] = m;
  const version = CURRENT_VERSION_BY_TYPE[type];
  if (!version) return new Response("not found", { status: 404 });

  if (!env.LEGAL_DOCS) return new Response("R2 not configured", { status: 500 });

  const key = type + "-" + version + "-" + lang + ".pdf";
  const object = await env.LEGAL_DOCS.get(key);
  if (!object) return new Response("not found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/pdf");
  headers.set("content-disposition", 'attachment; filename="' + key + '"');
  headers.set("cache-control", "public, max-age=3600"); // short — a new version can replace this key's target within the hour
  headers.set("etag", object.httpEtag);

  return new Response(object.body, { headers });
}

export async function onRequest(context) {
  if (context.request.method === "GET" || context.request.method === "HEAD") return onRequestGet(context);
  return new Response("method not allowed", { status: 405 });
}
