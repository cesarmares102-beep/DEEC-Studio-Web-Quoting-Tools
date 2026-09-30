/* ==========================================================================
   One-time / re-runnable tool: computes a reproducible SHA-256 over each
   legal document's actual body text (both languages), to seed/refresh
   legal_documents.content_hash. NOT part of the deployed site — run
   manually with `node hash-legal-docs.js` whenever a document's content
   changes and a new version is published, then paste the printed values
   into functions/lib/current-terms-version.js and the corresponding
   legal_documents INSERT.

   Canonical representation: the .legal-intro + .legal-body text content of
   each language's data-lang-content block, whitespace-collapsed. Excludes
   nav/header/version-history chrome, which isn't part of the legal text
   itself. Hashing both languages together (as one JSON object) means the
   hash changes if either language's text changes.
   ========================================================================== */
const fs = require("fs");

const DOCS = [
  { type: "terms", file: "terminos-condiciones-compra.html", version: "1.0" },
  { type: "privacy", file: "politica-privacidad.html", version: "1.0" },
  { type: "purchase_policy", file: "politica-pagos.html", version: "1.0" }
];

function extractLangBody(html, lang) {
  const blockRe = new RegExp('<div data-lang-content="' + lang + '"[^>]*>([\\s\\S]*?)\\n\\s*</div>\\s*\\n<div data-lang-content=', "m");
  let m = html.match(blockRe);
  let block = m ? m[1] : null;
  if (!block) {
    // "en" is the last data-lang-content block in these files, so the
    // lookahead above (which needs a following "<div data-lang-content=")
    // won't match it — fall back to "from the opening tag to </main>".
    const openRe = new RegExp('<div data-lang-content="' + lang + '"[^>]*>([\\s\\S]*)<\\/main>', "m");
    m = html.match(openRe);
    block = m ? m[1] : null;
  }
  if (!block) throw new Error('Could not find data-lang-content="' + lang + '" block');

  const introRe = /<p class="legal-intro">([\s\S]*?)<\/p>/;
  const bodyRe = /<div class="legal-body">([\s\S]*?)<\/div>\s*(<nav class="legal-doc-nav"|<a class="legal-back"|$)/;
  const intro = (block.match(introRe) || [, ""])[1];
  const body = (block.match(bodyRe) || [, ""])[1];

  return stripAndNormalize(intro + " " + body);
}

function stripAndNormalize(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256Hex(str) {
  return require("crypto").createHash("sha256").update(str, "utf8").digest("hex");
}

DOCS.forEach(function (doc) {
  const html = fs.readFileSync(doc.file, "utf8");
  const es = extractLangBody(html, "es");
  const en = extractLangBody(html, "en");
  if (es.length < 200 || en.length < 200) {
    throw new Error(doc.file + ": extracted text looks too short (es=" + es.length + " en=" + en.length + " chars) — extraction regex probably didn't match, refusing to hash a false result");
  }
  const canonical = JSON.stringify({ es: es, en: en });
  const hash = sha256Hex(canonical);
  console.log(doc.type, doc.version, hash, "(es:" + es.length + " chars, en:" + en.length + " chars)");
});
