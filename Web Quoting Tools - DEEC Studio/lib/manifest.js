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

    /* ⚠️ DATOS DE DEMOSTRACIÓN — declarado explícitamente.
       Estos nombres/ubicaciones/contadores NO son eventos reales. Antes de publicar,
       decide: (a) dejar isDemoData:true y mantenerlos como contenido ilustrativo, o
       (b) poner isDemoData:false y conectar names/visitorCounts a datos reales
       (webhook de ventas, analytics), nunca presentar la lista fija como compras reales. */
    socialProof: {
      isDemoData: true,
      product: "su cotizador personalizado", // fallback only — the i18n keys (socialproof.product) take priority
      names: ["Andrea", "Luis", "Marcela", "Jorge", "Paola", "Daniel"],
      /* Ubicaciones de compra — MX y US mezcladas a propósito. main.js
         alterna el país entre toasts consecutivos (misma lógica que ya usa
         para alternar el tipo de mensaje) para que ningún país se sienta
         dominante ni la mezcla se vea forzada. */
      locations: [
        { city: "CDMX", country: "MX" },
        { city: "Guadalajara", country: "MX" },
        { city: "Monterrey", country: "MX" },
        { city: "Puebla", country: "MX" },
        { city: "Querétaro", country: "MX" },
        { city: "Los Angeles, CA", country: "US" },
        { city: "Houston, TX", country: "US" },
        { city: "Dallas, TX", country: "US" },
        { city: "San Diego, CA", country: "US" },
        { city: "Phoenix, AZ", country: "US" },
        { city: "Chicago, IL", country: "US" },
        { city: "Miami, FL", country: "US" },
        { city: "Las Vegas, NV", country: "US" }
      ],
      visitorCounts: [6, 9, 12, 14, 18],
      rating: 4.8
    }
  };
})();
