/* ==========================================================================
   DEEC Studio — brand data & central configuration
   ========================================================================== */
(function () {
  "use strict";

  /**
   * Número de WhatsApp para los CTA de compra, en formato internacional
   * sin signos (52 = México, luego 10 dígitos).
   * Este es el ÚNICO lugar del proyecto donde se configura el número.
   */
  var WHATSAPP_NUMBER = "525642145001";

  // El mensaje de todos los puntos de contacto de WhatsApp (nav, FAB, y
  // los botones que antes decían "Comprar ahora") vive en lib/i18n.js
  // (clave "whatsapp.message") para seguir el idioma de la página — no
  // aquí. Todos los CTA del sitio abren WhatsApp; ya no hay checkout
  // embebido (ver initWhatsapp() en main.js).

  window.__BRAND__ = {
    name: "DEEC Studio",

    whatsapp: {
      number: WHATSAPP_NUMBER
    },

    // Lista blanca de valores válidos para el parámetro ?v= en la URL del
    // anuncio. Solo estos valores se insertan en el mensaje de WhatsApp —
    // cualquier otro valor en la URL se ignora (no se interpola texto libre
    // del query string sin validar).
    verticalLabels: {
      es: {
        landscaping: "landscaping / jardinería",
        cleaning: "limpieza",
        pressurewashing: "lavado a presión",
        autodetailing: "detallado automotriz"
      },
      en: {
        landscaping: "landscaping",
        cleaning: "cleaning",
        pressurewashing: "pressure washing",
        autodetailing: "auto detailing"
      }
    },

    /* ⚠️ DATOS DE DEMOSTRACIÓN — declarado explícitamente.
       Estos contadores NO son eventos reales. Antes de publicar, decide:
       (a) dejar isDemoData:true y mantenerlos como contenido ilustrativo, o
       (b) poner isDemoData:false y conectar visitorCounts a datos reales
       (analytics), nunca presentar un número fijo como una métrica real. */
    socialProof: {
      isDemoData: true,
      visitorCounts: [6, 9, 12, 14, 18]
    }
  };
})();
