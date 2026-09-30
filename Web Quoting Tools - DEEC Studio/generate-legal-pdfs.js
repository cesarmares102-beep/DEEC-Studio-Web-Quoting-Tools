/* ==========================================================================
   One-time / re-runnable tool: generates the OFFICIAL PDF for each legal
   document, in both languages, server-side — as a pure Node script (no
   browser DOM). This is a faithful port of main.js's
   buildLegalDocDefinition()/buildLegalPdfContent()/legalInlineRuns(), but
   parsing the .legal-intro/.legal-body HTML with regex instead of walking
   live DOM nodes, since Node has no DOM. Keep this in sync BY HAND with
   main.js's PDF-building functions if either one changes — main.js is
   still the one and only source of truth for what the PDF looks like when
   a visitor generates it live in the browser (the two must produce
   equivalent output).

   Run: node generate-legal-pdfs.js <output-dir>
   Requires: `npm install pdfmake` in a throwaway scratch directory (NOT
   this project's node_modules — this project has none, deliberately) and
   running this script from there with PDFMAKE_DIR pointing at it, e.g.:
     PDFMAKE_DIR=/path/to/scratch/pdfgen node generate-legal-pdfs.js /path/to/out

   Output: 6 files, "<type>-<version>-<lang>.pdf" (terms-1.0-es.pdf, etc).
   These are the files uploaded to R2 (see functions/api/admin/upload-legal-pdf.js)
   and served at /api/legal-pdf/<type>-<lang>.pdf (see
   functions/api/legal-pdf/[filename].js) — the SAME file used by the page's
   download button and the post-payment confirmation email.
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const pdfmakeDir = process.env.PDFMAKE_DIR;
if (!pdfmakeDir) throw new Error("Set PDFMAKE_DIR to the scratch dir where `npm install pdfmake` was run.");
// pdfmake 0.3.x's require('pdfmake') is a singleton instance with
// setFonts()/createPdf(), not the old PdfPrinter class — matches
// lib/vendor/pdfmake.min.js's window.pdfMake.createPdf() API shape used
// by main.js, just imported differently on the Node side.
const pdfMake = require(path.join(pdfmakeDir, "node_modules", "pdfmake"));

const { extractLangBlock } = require("./hash-legal-docs.js");

const DOCS = [
  { type: "terms", file: "terminos-condiciones-compra.html", docId: "terms-and-conditions" },
  { type: "privacy", file: "politica-privacidad.html", docId: "privacy-policy" },
  { type: "purchase_policy", file: "politica-pagos.html", docId: "payment-policy" }
];

/* ---- lib/legal-versions.js data, without a browser ---- */
global.window = {};
require("./lib/legal-versions.js");
const LEGAL_DOCS = global.window.__LEGAL_DOCS__;

const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function formatDateLong(iso, lang) {
  const parts = iso.split("-");
  const y = parts[0], m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
  if (lang === "en") return MONTHS_EN[m] + " " + d + ", " + y;
  return d + " de " + MONTHS_ES[m] + " de " + y;
}
function formatDateShort(iso) {
  const parts = iso.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}
function lastFiveVersions(doc) {
  return doc.versionHistory.slice().sort(function (a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  }).slice(0, 5);
}
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

/* ---- HTML fragment -> pdfmake inline runs (mirrors main.js legalInlineRuns) ---- */
function legalInlineRuns(html) {
  const runs = [];
  const re = /<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|<(strong|b)>([\s\S]*?)<\/\3>|<br\s*\/?>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      runs.push({ text: decodeEntities(m[2]), link: m[1], color: "#3f6b3f", decoration: "underline" });
    } else if (m[3] !== undefined) {
      runs.push({ text: decodeEntities(m[4]), bold: true });
    } else if (m[5] !== undefined) {
      const text = decodeEntities(m[5]);
      if (text) runs.push({ text: text });
    } else {
      runs.push({ text: "\n" });
    }
  }
  return runs.length ? runs : [{ text: "" }];
}

/* ---- top-level .legal-body blocks -> pdfmake content nodes ---- */
function parseBlocks(bodyHtml) {
  const blocks = [];
  const re = /<h2>([\s\S]*?)<\/h2>|<h3>([\s\S]*?)<\/h3>|<p>([\s\S]*?)<\/p>|<ul>([\s\S]*?)<\/ul>/g;
  let m;
  while ((m = re.exec(bodyHtml))) {
    if (m[1] !== undefined) blocks.push({ tag: "h2", node: { text: decodeEntities(m[1]).trim(), style: "legalH2" } });
    else if (m[2] !== undefined) blocks.push({ tag: "h3", node: { text: decodeEntities(m[2]).trim(), style: "legalH3" } });
    else if (m[3] !== undefined) blocks.push({ tag: "p", node: { text: legalInlineRuns(m[3]), style: "legalP" } });
    else if (m[4] !== undefined) {
      const liRe = /<li>([\s\S]*?)<\/li>/g;
      const items = [];
      let li;
      while ((li = liRe.exec(m[4]))) items.push({ text: legalInlineRuns(li[1]) });
      blocks.push({ tag: "ul", node: { ul: items, style: "legalP" } });
    }
  }
  return blocks;
}

function legalHistoryTablePdf(doc, lang) {
  const head = lang === "en" ? ["Version", "Date", "Description"] : ["Versión", "Fecha", "Descripción"];
  const body = [head.map(function (h) { return { text: h, style: "legalTableHeader" }; })];
  lastFiveVersions(doc).forEach(function (r) {
    body.push([
      { text: "v" + r.version, style: "legalTableCell" },
      { text: formatDateShort(r.date), style: "legalTableCell" },
      { text: (r.description && r.description[lang]) || "", style: "legalTableCell" }
    ]);
  });
  return {
    table: { headerRows: 1, widths: [42, 62, "*"], body: body },
    layout: {
      hLineWidth: function (i, node) { return (i === 0 || i === 1 || i === node.table.body.length) ? .75 : .5; },
      vLineWidth: function () { return 0; },
      hLineColor: function () { return "#d1d5db"; },
      paddingTop: function () { return 4; },
      paddingBottom: function () { return 4; }
    },
    margin: [0, 0, 0, 4]
  };
}

function buildLegalPdfContent(doc, lang, bodyHtml, introHtml) {
  const content = [];
  content.push({ text: "DEEC STUDIO", style: "legalBrand" });
  content.push({ text: doc.title[lang], style: "legalCoverTitle" });
  content.push({ text: (lang === "en" ? "Current version: v" : "Versión vigente: v") + doc.currentVersion, style: "legalMeta" });
  content.push({ text: (lang === "en" ? "Last updated: " : "Fecha de actualización: ") + formatDateLong(doc.updatedAt, lang), style: "legalMeta" });
  content.push({ text: lang === "en" ? "VERSION HISTORY" : "HISTORIAL DE VERSIONES", style: "legalHistoryHeading" });
  content.push(legalHistoryTablePdf(doc, lang));
  content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: .5, lineColor: "#d1d5db" }], margin: [0, 12, 0, 14] });

  if (introHtml) content.push({ text: legalInlineRuns(introHtml), style: "legalP" });

  const blocks = parseBlocks(bodyHtml);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if ((b.tag === "h2" || b.tag === "h3") && blocks[i + 1]) {
      content.push({ stack: [b.node, blocks[i + 1].node], unbreakable: true });
      i++;
      continue;
    }
    content.push(b.node);
  }
  return content;
}

function buildLegalDocDefinition(doc, lang, bodyHtml, introHtml) {
  return {
    info: { title: doc.title[lang] + " v" + doc.currentVersion, author: "Deec Studio" },
    pageMargins: [40, 82, 40, 46],
    header: function () {
      return {
        margin: [40, 18, 40, 0],
        stack: [
          { text: "DEEC STUDIO · " + doc.title[lang].toUpperCase(), style: "legalRunningTitle" },
          {
            text: (lang === "en" ? "Version v" : "Versión v") + doc.currentVersion + " · " +
              (lang === "en" ? "Updated: " : "Actualizado: ") + formatDateShort(doc.updatedAt),
            style: "legalRunningSub"
          },
          { canvas: [{ type: "line", x1: 0, y1: 2, x2: 515, y2: 2, lineWidth: .5, lineColor: "#d1d5db" }] }
        ]
      };
    },
    footer: function (currentPage, pageCount) {
      return {
        margin: [40, 0, 40, 18],
        columns: [
          { text: "Deec Studio · deecstudio-quotingtools.online", style: "legalFooterText" },
          {
            text: (lang === "en" ? "Page " + currentPage + " of " + pageCount : "Página " + currentPage + " de " + pageCount),
            style: "legalFooterText",
            alignment: "right"
          }
        ]
      };
    },
    content: buildLegalPdfContent(doc, lang, bodyHtml, introHtml),
    styles: {
      legalBrand: { fontSize: 9, bold: true, color: "#6b7280", margin: [0, 0, 0, 4] },
      legalCoverTitle: { fontSize: 19, bold: true, margin: [0, 0, 0, 10] },
      legalMeta: { fontSize: 10, margin: [0, 0, 0, 2], color: "#374151" },
      legalHistoryHeading: { fontSize: 10, bold: true, margin: [0, 16, 0, 6], color: "#374151" },
      legalTableHeader: { fontSize: 9, bold: true, fillColor: "#f3f4f6" },
      legalTableCell: { fontSize: 9 },
      legalH2: { fontSize: 13, bold: true, margin: [0, 14, 0, 6] },
      legalH3: { fontSize: 11, bold: true, margin: [0, 10, 0, 4] },
      legalP: { fontSize: 10, margin: [0, 0, 0, 8], lineHeight: 1.25 },
      legalRunningTitle: { fontSize: 8, bold: true, color: "#111827" },
      legalRunningSub: { fontSize: 7.5, color: "#6b7280", margin: [0, 1, 0, 4] },
      legalFooterText: { fontSize: 8, color: "#9ca3af" }
    },
    defaultStyle: { font: "Roboto" }
  };
}

function extractIntroAndBody(block) {
  const introRe = /<p class="legal-intro">([\s\S]*?)<\/p>/;
  const bodyRe = /<div class="legal-body">([\s\S]*?)<\/div>\s*(<nav class="legal-doc-nav"|<a class="legal-back"|$)/;
  const intro = (block.match(introRe) || [, ""])[1];
  const body = (block.match(bodyRe) || [, ""])[1];
  return { intro, body };
}

let fontsConfigured = false;
async function renderPdfBuffer(docDefinition) {
  if (!fontsConfigured) {
    pdfMake.setFonts({
      Roboto: {
        normal: path.join(pdfmakeDir, "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Regular.ttf"),
        bold: path.join(pdfmakeDir, "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Medium.ttf"),
        italics: path.join(pdfmakeDir, "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-Italic.ttf"),
        bolditalics: path.join(pdfmakeDir, "node_modules", "pdfmake", "fonts", "Roboto", "Roboto-MediumItalic.ttf")
      }
    });
    pdfMake.setLocalAccessPolicy(function () { return true; }); // fonts above are local files
    pdfMake.setUrlAccessPolicy(function () { return false; }); // no remote resources used
    fontsConfigured = true;
  }
  const doc = pdfMake.createPdf(docDefinition);
  return doc.getBuffer();
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error("Usage: node generate-legal-pdfs.js <output-dir>");
  fs.mkdirSync(outDir, { recursive: true });

  for (const d of DOCS) {
    const html = fs.readFileSync(d.file, "utf8");
    const doc = LEGAL_DOCS[d.docId];
    if (!doc) throw new Error("No lib/legal-versions.js entry for " + d.docId);

    for (const lang of ["es", "en"]) {
      const block = extractLangBlock(html, lang);
      const { intro, body } = extractIntroAndBody(block);
      if (!body || body.length < 200) throw new Error(d.file + " (" + lang + "): legal-body extraction looks too short, refusing to generate");

      const docDefinition = buildLegalDocDefinition(doc, lang, body, intro);
      const buffer = await renderPdfBuffer(docDefinition);
      const outFile = path.join(outDir, d.type + "-" + doc.currentVersion + "-" + lang + ".pdf");
      fs.writeFileSync(outFile, buffer);
      console.log("Wrote " + outFile + " (" + buffer.length + " bytes)");
    }
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
