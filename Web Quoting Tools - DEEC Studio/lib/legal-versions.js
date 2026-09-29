/* ==========================================================================
   DEEC Studio — legal document version metadata (vanilla JS, no build step)

   Single source of truth for each legal document's current version, last
   update date, and version history. Consumed by lib/legal.js to render the
   on-page version block/history table AND to build the downloadable PDF —
   so the web view and the PDF can never drift apart (see lib/legal.js).

   To publish a new version of a document: prepend one entry to that
   document's versionHistory (newest first is the convention here, though
   legal.js re-sorts by date defensively), update currentVersion/updatedAt
   to match, and leave every older entry in place — legal.js only ever
   *displays* the 5 most recent, it never deletes anything from this file,
   so older versions stay available as an internal historical record.

   Each entry's date is ISO (YYYY-MM-DD); legal.js formats it per-language
   for display. Seeded at v1.0 using this project's actual last-known
   "última actualización" date for that document — no earlier version
   history exists to record.
   ========================================================================== */
(function () {
  "use strict";

  window.__LEGAL_DOCS__ = {
    "site-usage-notice": {
      pdfFileBase: "Deec_Studio_Aviso_de_Uso_del_Sitio",
      title: { es: "Aviso de Uso del Sitio", en: "Site Usage Notice" },
      currentVersion: "1.0",
      updatedAt: "2026-09-28",
      versionHistory: [
        { version: "1.0", date: "2026-09-28", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    },
    "privacy-policy": {
      pdfFileBase: "Deec_Studio_Politica_de_Privacidad",
      title: { es: "Política de Privacidad", en: "Privacy Policy" },
      currentVersion: "1.0",
      updatedAt: "2026-09-29",
      versionHistory: [
        { version: "1.0", date: "2026-09-29", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    },
    "cookie-policy": {
      pdfFileBase: "Deec_Studio_Politica_de_Cookies",
      title: { es: "Política de Cookies", en: "Cookie Policy" },
      currentVersion: "1.0",
      updatedAt: "2026-09-28",
      versionHistory: [
        { version: "1.0", date: "2026-09-28", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    },
    "ai-usage-notice": {
      pdfFileBase: "Deec_Studio_Aviso_de_Uso_de_IA",
      title: { es: "Aviso de Uso de Inteligencia Artificial", en: "Artificial Intelligence Usage Notice" },
      currentVersion: "1.0",
      updatedAt: "2026-09-28",
      versionHistory: [
        { version: "1.0", date: "2026-09-28", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    },
    "payment-policy": {
      pdfFileBase: "Deec_Studio_Politica_de_Pagos_Cancelaciones_y_Reembolsos",
      title: { es: "Política de Pagos, Cancelaciones y Reembolsos", en: "Payment, Cancellation and Refund Policy" },
      currentVersion: "1.0",
      updatedAt: "2026-09-29",
      versionHistory: [
        { version: "1.0", date: "2026-09-29", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    },
    "terms-and-conditions": {
      pdfFileBase: "Deec_Studio_Terminos_y_Condiciones_de_Compra",
      title: { es: "Términos y Condiciones de Compra", en: "Terms and Conditions of Purchase" },
      currentVersion: "1.0",
      updatedAt: "2026-09-29",
      versionHistory: [
        { version: "1.0", date: "2026-09-29", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    },
    "ip-policy": {
      pdfFileBase: "Deec_Studio_Politica_de_Propiedad_Intelectual",
      title: { es: "Política de Propiedad Intelectual", en: "Intellectual Property Policy" },
      currentVersion: "1.0",
      updatedAt: "2026-09-29",
      versionHistory: [
        { version: "1.0", date: "2026-09-29", description: { es: "Publicación inicial", en: "Initial publication" } }
      ]
    }
  };
})();
