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
  { type: "privacy", file: "politica-privacidad.html", version: "1.1" },
  { type: "purchase_policy", file: "politica-pagos.html", version: "1.0" }
];

function extractLangBlock(html, lang) {
  // \s* (not a literal \n) before the next <div data-lang-content= — the
  // indentation preceding that tag isn't consistent across every legal
  // page (some have none, some have 4 spaces), and a literal \n here
  // silently failed to match on the indented files, falling through to
  // the "everything until </main>" fallback below and pulling BOTH
  // languages into what was supposed to be a single-language block.
  const blockRe = new RegExp('<div data-lang-content="' + lang + '"[^>]*>([\\s\\S]*?)\\n\\s*</div>\\s*<div data-lang-content=', "m");
  let m = html.match(blockRe);
  let block = m ? m[1] : null;
  if (!block) {
    const openRe = new RegExp('<div data-lang-content="' + lang + '"[^>]*>([\\s\\S]*)<\\/main>', "m");
    m = html.match(openRe);
    block = m ? m[1] : null;
  }
  if (!block) throw new Error('Could not find data-lang-content="' + lang + '" block');
  return block;
}

function extractLangBody(html, lang) {
  const block = extractLangBlock(html, lang);
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

if (require.main === module) {
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
}

module.exports = { DOCS, extractLangBlock, extractLangBody, stripAndNormalize, sha256Hex };
