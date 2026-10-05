/* ==========================================================================
   DEEC Studio — main.js (vanilla JS, IIFE, no build step, no deps)
   ========================================================================== */
(function () {
  "use strict";

  var data = window.__BRAND__ || {};
  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };
  var fineHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var refreshSocialProofToast = null; // set by initSocialProof(), called from applyLanguage()
  var refreshWhatsappLinks = null; // set by initWhatsapp(), called from applyLanguage()
  var refreshCheckoutGeoLabels = null; // set by initCheckoutGeo(), called from applyLanguage()
  var refreshCheckoutPhoneLabels = null; // set by initCheckoutPhone(), called from applyLanguage()

  function safe(fn, name) {
    try { fn(); } catch (e) { if (window.console) console.warn("[" + name + "]", e); }
  }

  /* -------------------------------------------------------------
     Web fonts — flip the media="print" stylesheets (see index.html)
     to "all" so they apply without having blocked first paint.
     ------------------------------------------------------------- */
  function initFontStylesheets() {
    $$("[data-font-stylesheet]").forEach(function (link) {
      link.media = "all";
    });
  }

  /* -------------------------------------------------------------
     i18n — drives every [data-i18n] node on the page (nav, sections,
     FAQ, popups). Initial language always follows the browser/device
     language at the moment the page loads (defaulting to "es" for
     anything that isn't English) — a manual toggle only applies to
     the current page view, it isn't remembered for the next visit,
     so the site keeps re-syncing to whatever the device is set to.
     ------------------------------------------------------------- */
  var I18N = window.__I18N__ || { es: {}, en: {} };
  function detectInitialLang() {
    var browserLang = (navigator.language || (navigator.languages && navigator.languages[0]) || "es");
    return /^en/i.test(browserLang) ? "en" : "es";
  }
  var currentLang = detectInitialLang();
  function t(key) {
    var dict = I18N[currentLang] || I18N.es || {};
    return dict[key] != null ? dict[key] : key;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /* -------------------------------------------------------------
     WhatsApp contact points — nav icon, FAB, and every former
     "Comprar ahora" CTA (nav menu, sticky bar, hero, oferta). All of
     them now share [data-whatsapp-cta] and open a WhatsApp chat
     instead of an embedded checkout — the strategy is to qualify the
     lead in conversation, not to sell inside an iframe. See
     lib/manifest.js for the number and lib/i18n.js's "whatsapp.message"
     key for the prefilled text (follows the page's language).
     Falls back to a warning toast if no real number is configured.
     ------------------------------------------------------------- */
  function isWhatsappConfigured() {
    var wa = data.whatsapp || {};
    var digits = String(wa.number || "").replace(/\D/g, "");
    return digits.length >= 8 && !/x/i.test(String(wa.number || ""));
  }

  function initWhatsapp() {
    var links = $$("[data-whatsapp-cta]");
    if (!links.length) return;
    var wa = data.whatsapp || {};
    var configured = isWhatsappConfigured();

    // Reads ?v= from the ad's URL and validates it against
    // window.__BRAND__.verticalLabels (see manifest.js). An unrecognized
    // value is silently ignored and falls back to the generic message —
    // free-form query-string text is never interpolated unvalidated.
    function getVerticalLabel() {
      try {
        var raw = new URLSearchParams(window.location.search).get("v");
        if (!raw) return null;
        var key = raw.toLowerCase().trim();
        var labels = (data.verticalLabels && data.verticalLabels[currentLang]) || (data.verticalLabels && data.verticalLabels.es) || {};
        return labels[key] || null;
      } catch (e) {
        return null;
      }
    }

    // Message follows the page's current language (i18n) — the phone
    // number itself doesn't, that's fixed business config in manifest.js.
    function buildHref() {
      if (!configured) return "#";
      var vertical = getVerticalLabel();
      var message = vertical
        ? fillTemplate(t("whatsapp.messageVertical"), { vertical: vertical })
        : t("whatsapp.message");
      return "https://wa.me/" + wa.number.replace(/\D/g, "") + "?text=" + encodeURIComponent(message);
    }
    function applyHref() {
      var href = buildHref();
      links.forEach(function (a) { a.setAttribute("href", href); });
    }
    refreshWhatsappLinks = configured ? applyHref : null;
    applyHref();

    links.forEach(function (a) {
      if (configured) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      }
      a.addEventListener("click", function (e) {
        if (!configured) {
          e.preventDefault();
          showToast(t("toast.whatsappNotConfigured"));
          return;
        }
        // Meta Pixel "Contact" — Meta's standard event for a click that
        // opens a messaging app (WhatsApp/Messenger), which is exactly
        // what every CTA on the page does now instead of an embedded
        // checkout. Guarded so a blocked/failed pixel can't stop the
        // WhatsApp link from opening.
        try {
          if (window.fbq) window.fbq("track", "Contact");
        } catch (err) { if (window.console) console.warn("[fbq Contact]", err); }
      });
    });
  }

  /* -------------------------------------------------------------
     Warning toast — sección 2.C (e.g. WhatsApp not configured)
     ------------------------------------------------------------- */
  var toastTimer = null;
  function showToast(html) {
    var host = $("[data-toast]");
    if (!host) return;
    host.innerHTML = "<p>" + html + "</p>";
    host.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      host.classList.remove("is-visible");
    }, 4200);
  }

  /* -------------------------------------------------------------
     Nav — floating pill, transparent -> solid on scroll (sección 1)
     ------------------------------------------------------------- */
  function initNav() {
    var nav = $("[data-nav]");
    if (!nav) return;
    var onScroll = function () {
      if (window.scrollY > 12) nav.classList.add("is-scrolled");
      else nav.classList.remove("is-scrolled");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function initNavHeight() {
    var nav = $("[data-nav]");
    if (!nav) return;
    var set = function () {
      // --nav-h is used as a "top:" offset by popups anchored under the nav
      // (menu panel, social-proof toast), so it must be the nav's distance
      // from the viewport top (top + height), not just its own height —
      // the nav floats with its own top gap, so "height" alone left those
      // popups overlapping the bottom of the pill instead of clearing it.
      var r = nav.getBoundingClientRect();
      document.documentElement.style.setProperty("--nav-h", r.bottom + "px");
    };
    set();
    window.addEventListener("resize", debounce(set, 120));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(set).catch(function () {});
    }
  }

  /* -------------------------------------------------------------
     Menu dropdown panel — sección 1.8. Anchored under the nav,
     not full-screen; same behavior at every breakpoint.
     ------------------------------------------------------------- */
  function initMenuPanel() {
    var toggle = $("[data-menu-toggle]");
    var panel = $("[data-menu-panel]");
    var backdrop = $("[data-menu-backdrop]");
    if (!toggle || !panel || !backdrop) return;

    function open() {
      panel.hidden = false;
      backdrop.hidden = false;
      // Forced reflow instead of requestAnimationFrame: rAF can be
      // throttled/delayed (backgrounded tab, low-power mode, some
      // automation contexts), which would leave the panel technically
      // open but stuck at opacity:0 until it fired. This read forces the
      // browser to commit the hidden->visible change first, so the very
      // next style change (.is-open) still transitions instead of getting
      // coalesced away.
      void panel.offsetHeight;
      panel.classList.add("is-open");
      backdrop.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", t("a11y.closeMenu"));
    }
    function close() {
      panel.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", t("a11y.openMenu"));
      setTimeout(function () {
        panel.hidden = true;
        backdrop.hidden = true;
      }, 300);
    }

    toggle.addEventListener("click", function () {
      if (toggle.getAttribute("aria-expanded") === "true") close();
      else open();
    });
    backdrop.addEventListener("click", close);
    $$("a", panel).forEach(function (a) {
      a.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") close();
    });
  }

  /* -------------------------------------------------------------
     Language toggle — sección 1.6
     ------------------------------------------------------------- */
  function applyLanguage() {
    document.documentElement.setAttribute("lang", currentLang);
    $$("[data-i18n]").forEach(function (el) {
      el.innerHTML = t(el.getAttribute("data-i18n"));
    });
    $$("[data-i18n-aria]").forEach(function (el) {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    $$("[data-i18n-placeholder]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
    // Whole-block language switch — for long-form content (legal pages)
    // that's written once per language directly in the HTML instead of
    // going through the i18n dictionary above (hundreds of one-off
    // paragraph keys would bloat lib/i18n.js for text nobody reuses).
    // Each block just needs data-lang-content="es"/"en"; only the one
    // matching currentLang stays visible.
    $$("[data-lang-content]").forEach(function (el) {
      el.hidden = el.getAttribute("data-lang-content") !== currentLang;
    });
    $$("[data-lang]").forEach(function (btn) {
      var active = btn.getAttribute("data-lang") === currentLang;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    // Menu toggle has two labels depending on open/closed state, not just
    // language — keep it in sync with whichever state it's currently in.
    var menuToggle = $("[data-menu-toggle]");
    if (menuToggle) {
      var menuOpen = menuToggle.getAttribute("aria-expanded") === "true";
      menuToggle.setAttribute("aria-label", t(menuOpen ? "a11y.closeMenu" : "a11y.openMenu"));
    }
    // Recalculate open accordion / menu-panel heights if text length changed
    accordionGroups.forEach(function (group) {
      group.items.forEach(function (item) {
        if (item.root.classList.contains("is-open") && item.panel.style.maxHeight !== "") {
          item.panel.style.maxHeight = item.panel.scrollHeight + "px";
        }
      });
    });
    // Social proof toast text isn't marked [data-i18n] (it's built from a
    // template, not static markup) — re-render whichever toast is on
    // screen right now instead of leaving it in the old language until
    // its own timer cycles it out.
    if (refreshSocialProofToast) refreshSocialProofToast();
    if (refreshWhatsappLinks) refreshWhatsappLinks();
    if (refreshCheckoutGeoLabels) refreshCheckoutGeoLabels();
    if (refreshCheckoutPhoneLabels) refreshCheckoutPhoneLabels();
  }

  function initLangToggle() {
    var buttons = $$("[data-lang]");
    if (!buttons.length) return;
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        // "Single" mode (checkout's nav — only the current language's
        // name is ever shown, no flags, no second button visible): the
        // one visible button always means "switch to the other
        // language", regardless of which data-lang it's labeled with.
        var toggle = btn.closest("[data-lang-toggle]");
        var single = toggle && toggle.hasAttribute("data-lang-toggle-single");
        var lang = single ? (currentLang === "es" ? "en" : "es") : btn.getAttribute("data-lang");
        if (lang === currentLang) return;
        currentLang = lang;
        applyLanguage();
      });
    });
    applyLanguage();
  }

  /* -------------------------------------------------------------
     Footer categories accordion — each category is a native <details>.
     Below 720px it's a real collapsible accordion (see styles.css); at
     720px and up the CSS turns the same markup into 4 static columns,
     so every <details> must be forced open there and stay that way —
     clicks on the summary are blocked above that breakpoint, and any
     group left closed by a narrower visit is forced back open when the
     viewport grows past it (e.g. rotating a tablet, resizing).
     ------------------------------------------------------------- */
  function initFooterAccordion() {
    var groups = $$(".footer-cat");
    if (!groups.length) return;
    var bp = 719;

    document.addEventListener("click", function (e) {
      var summary = e.target.closest ? e.target.closest(".footer-cat > summary") : null;
      if (!summary) return;
      if (window.innerWidth > bp) e.preventDefault();
    });

    function syncOpenState() {
      if (window.innerWidth > bp) {
        groups.forEach(function (g) { g.open = true; });
      }
    }
    syncOpenState();
    window.addEventListener("resize", syncOpenState);
  }

  /* -------------------------------------------------------------
     Legal document versioning + PDF export.

     Single source of truth: lib/legal-versions.js (window.__LEGAL_DOCS__).
     A legal page's <body data-legal-doc="..."> names its entry there. This
     module reads that same entry to (a) fill in the on-page "current
     version" line + last-5 history table, in both language blocks, and
     (b) build the downloadable PDF straight from the live DOM of whichever
     language block is currently visible — the .legal-intro paragraph and
     .legal-body markup already on the page, walked node-by-node into a
     pdfmake content tree. Nothing here duplicates the legal text: the web
     page IS the content source for the PDF too, so they can't drift apart.

     pdfmake itself (lib/vendor/pdfmake.min.js + pdfmake.vfs_fonts.js,
     vendored locally — the site's CSP only allows 'self' scripts, and a
     third-party CDN would be blocked outright) is only fetched lazily,
     the first time someone actually clicks "Descargar PDF", so it never
     costs bytes on a page load that doesn't need it.
     ------------------------------------------------------------- */
  var MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function formatDateLong(iso, lang) {
    var parts = iso.split("-");
    var y = parts[0], m = parseInt(parts[1], 10) - 1, d = parseInt(parts[2], 10);
    if (lang === "en") return MONTHS_EN[m] + " " + d + ", " + y;
    return d + " de " + MONTHS_ES[m] + " de " + y;
  }
  function formatDateShort(iso) {
    var parts = iso.split("-");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function lastFiveVersions(doc) {
    return doc.versionHistory.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    }).slice(0, 5);
  }

  function renderLegalVersionBlock(docId) {
    var doc = window.__LEGAL_DOCS__ && window.__LEGAL_DOCS__[docId];
    if (!doc) return;
    ["es", "en"].forEach(function (lang) {
      var scope = $('[data-lang-content="' + lang + '"]');
      if (!scope) return;
      var updatedEl = $("[data-legal-updated]", scope);
      if (updatedEl) {
        var label = lang === "en" ? "Last updated: " : "Última actualización: ";
        updatedEl.textContent = label + formatDateLong(doc.updatedAt, lang);
      }
      var versionEl = $("[data-legal-version-current]", scope);
      if (versionEl) versionEl.textContent = "v" + doc.currentVersion;
      var tbody = $("[data-legal-version-table] tbody", scope);
      if (tbody) {
        tbody.innerHTML = lastFiveVersions(doc).map(function (r) {
          var descr = (r.description && r.description[lang]) || "";
          return "<tr><td>v" + escapeHtml(r.version) + "</td><td>" + formatDateShort(r.date) + "</td><td>" + escapeHtml(descr) + "</td></tr>";
        }).join("");
      }
    });
  }

  /* ---- HTML (.legal-intro / .legal-body) -> pdfmake content tree ---- */
  function legalInlineRuns(el) {
    var runs = [];
    Array.prototype.forEach.call(el.childNodes, function (child) {
      if (child.nodeType === 3) {
        if (child.textContent) runs.push({ text: child.textContent });
        return;
      }
      if (child.nodeType !== 1) return;
      var tag = child.tagName.toLowerCase();
      if (tag === "a") {
        runs.push({ text: child.textContent, link: child.getAttribute("href") || "", color: "#3f6b3f", decoration: "underline" });
      } else if (tag === "strong" || tag === "b") {
        runs.push({ text: child.textContent, bold: true });
      } else if (tag === "br") {
        runs.push({ text: "\n" });
      } else if (child.textContent) {
        runs.push({ text: child.textContent });
      }
    });
    return runs.length ? runs : [{ text: "" }];
  }
  function legalBlockToPdf(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === "h2") return { text: el.textContent, style: "legalH2" };
    if (tag === "h3") return { text: el.textContent, style: "legalH3" };
    if (tag === "p") return { text: legalInlineRuns(el), style: "legalP" };
    if (tag === "ul") {
      return {
        ul: Array.prototype.map.call(el.children, function (li) {
          return { text: legalInlineRuns(li) };
        }),
        style: "legalP"
      };
    }
    return null;
  }
  function legalHistoryTablePdf(doc, lang) {
    var head = lang === "en" ? ["Version", "Date", "Description"] : ["Versión", "Fecha", "Descripción"];
    var body = [head.map(function (h) { return { text: h, style: "legalTableHeader" }; })];
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
  function buildLegalPdfContent(doc, lang, scope) {
    var content = [];
    content.push({ text: "DEEC STUDIO", style: "legalBrand" });
    content.push({ text: doc.title[lang], style: "legalCoverTitle" });
    content.push({ text: (lang === "en" ? "Current version: v" : "Versión vigente: v") + doc.currentVersion, style: "legalMeta" });
    content.push({ text: (lang === "en" ? "Last updated: " : "Fecha de actualización: ") + formatDateLong(doc.updatedAt, lang), style: "legalMeta" });
    content.push({ text: lang === "en" ? "VERSION HISTORY" : "HISTORIAL DE VERSIONES", style: "legalHistoryHeading" });
    content.push(legalHistoryTablePdf(doc, lang));
    content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: .5, lineColor: "#d1d5db" }], margin: [0, 12, 0, 14] });

    var introEl = $(".legal-intro", scope);
    if (introEl) content.push({ text: legalInlineRuns(introEl), style: "legalP" });

    var bodyEl = $(".legal-body", scope);
    if (bodyEl) {
      var kids = Array.prototype.slice.call(bodyEl.children);
      for (var i = 0; i < kids.length; i++) {
        var tag = kids[i].tagName.toLowerCase();
        var node = legalBlockToPdf(kids[i]);
        if (!node) continue;
        if ((tag === "h2" || tag === "h3") && kids[i + 1]) {
          var nextNode = legalBlockToPdf(kids[i + 1]);
          if (nextNode) {
            content.push({ stack: [node, nextNode], unbreakable: true });
            i++;
            continue;
          }
        }
        content.push(node);
      }
    }
    return content;
  }
  function buildLegalDocDefinition(doc, lang, scope) {
    return {
      info: { title: doc.title[lang] + " v" + doc.currentVersion, author: "Deec Studio" },
      pageMargins: [40, 82, 40, 46],
      header: function (currentPage) {
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
          ],
          // Header repeats identically on every page (including page 1,
          // where the fuller in-content version block already appears
          // right below it) — currentPage isn't used, kept for clarity.
          _page: currentPage
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
      content: buildLegalPdfContent(doc, lang, scope),
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

  var pdfVendorPromise = null;
  function loadPdfVendor() {
    if (window.pdfMake && window.pdfMake.createPdf) return Promise.resolve();
    if (pdfVendorPromise) return pdfVendorPromise;
    pdfVendorPromise = new Promise(function (resolve, reject) {
      var s1 = document.createElement("script");
      s1.src = "lib/vendor/pdfmake.min.js";
      s1.onload = function () {
        var s2 = document.createElement("script");
        s2.src = "lib/vendor/pdfmake.vfs_fonts.js";
        s2.onload = function () { resolve(); };
        s2.onerror = function () { reject(new Error("pdfmake vfs_fonts failed to load")); };
        document.body.appendChild(s2);
      };
      s1.onerror = function () { reject(new Error("pdfmake failed to load")); };
      document.body.appendChild(s1);
    });
    return pdfVendorPromise;
  }

  // The 3 documents referenced by the checkout's terms checkbox (see
  // functions/api/checkout/create.js) have an OFFICIAL, pre-generated PDF
  // in R2 — the same file this button downloads, the same file the
  // post-payment confirmation email links to (see
  // functions/api/webhooks/whop.js). Every other legal doc keeps
  // generating its PDF live from the page, as before.
  var OFFICIAL_PDF_TYPE_BY_DOC_ID = {
    "terms-and-conditions": "terms",
    "privacy-policy": "privacy",
    "payment-policy": "purchase_policy"
  };

  function initLegalVersioning() {
    var docId = document.body.getAttribute("data-legal-doc");
    if (!docId) return;
    renderLegalVersionBlock(docId);

    var officialType = OFFICIAL_PDF_TYPE_BY_DOC_ID[docId];

    $$("[data-legal-pdf-download]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;

        if (officialType) {
          window.location.href = "/api/legal-pdf/" + officialType + "-" + currentLang + ".pdf";
          return;
        }

        var doc = window.__LEGAL_DOCS__ && window.__LEGAL_DOCS__[docId];
        if (!doc) return;
        var scope = $('[data-lang-content="' + currentLang + '"]');
        if (!scope) return;
        var label = $("span", btn);
        var originalText = label ? label.textContent : "";
        btn.disabled = true;
        if (label) label.textContent = t("legal.downloadingPdf");
        loadPdfVendor().then(function () {
          var docDefinition = buildLegalDocDefinition(doc, currentLang, scope);
          var filename = doc.pdfFileBase + "_v" + doc.currentVersion + ".pdf";
          window.pdfMake.createPdf(docDefinition).download(filename);
        }).catch(function (err) {
          if (window.console) console.warn("[legal-pdf]", err);
          showToast(t("toast.pdfError"));
        }).then(function () {
          btn.disabled = false;
          if (label) label.textContent = originalText;
        });
      });
    });
  }

  /* -------------------------------------------------------------
     Smooth anchor scroll (native)
     ------------------------------------------------------------- */
  function initSmoothAnchors() {
    document.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute("href");
      if (!id || id === "#") return;
      var el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      var navOffset = 76;
      var top = el.getBoundingClientRect().top + window.scrollY - navOffset;
      window.scrollTo({
        top: top,
        behavior: reduced ? "auto" : "smooth"
      });
    });
  }

  /* -------------------------------------------------------------
     Reveal on scroll — universal, functional (never fully gated)
     ------------------------------------------------------------- */
  function initReveals() {
    var els = $$("[data-reveal]");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-revealed"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.01, rootMargin: "0px 0px -2% 0px" });
    els.forEach(function (el) { io.observe(el); });

    // Safety net — reveal anything still hidden above the fold after 6s
    setTimeout(function () {
      $$("[data-reveal]:not(.is-revealed)").forEach(function (el) {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          el.classList.add("is-revealed");
        }
      });
    }, 6000);
  }

  /* -------------------------------------------------------------
     Personalización — ciclo automático de 4 etapas (mockup +
     timeline). Temporizador propio (no scroll-pinning): avanza
     cada 3.2s mientras la sección está en pantalla; se detiene por
     completo (clearInterval) al salir de vista. Respeta
     prefers-reduced-motion quedándose fijo en la primera etapa.
     ------------------------------------------------------------- */
  function initPersonalizacion() {
    var track = document.querySelector("[data-pv-track]");
    if (!track) return;

    var mockups = $$("[data-pv-stage].pv-mockup");
    var steps = $$("[data-pv-stage].pv-step");
    var timeline = document.querySelector("[data-pv-timeline]");
    var stages = ["generic", "business", "services", "final"];
    var STAGE_MS = 3200;

    var current = -1;
    function setStage(index) {
      index = ((index % stages.length) + stages.length) % stages.length;
      if (index === current) return;
      current = index;
      var stage = stages[index];
      var activeStep = null;

      mockups.forEach(function (el) {
        el.classList.toggle("is-active", el.getAttribute("data-pv-stage") === stage);
      });
      steps.forEach(function (el) {
        var isActive = el.getAttribute("data-pv-stage") === stage;
        el.classList.toggle("is-active", isActive);
        if (isActive) activeStep = el;
      });

      if (activeStep && timeline && timeline.scrollWidth > timeline.clientWidth) {
        var target = activeStep.offsetLeft - timeline.clientWidth * 0.06;
        timeline.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
      }
    }

    setStage(0);

    if (reduced) return;

    var timer = null;
    function start() {
      if (timer) return;
      timer = setInterval(function () { setStage(current + 1); }, STAGE_MS);
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) start(); else stop();
        });
      }, { threshold: 0.35 });
      io.observe(track);
    } else {
      start();
    }
  }

  /* -------------------------------------------------------------
     Transform showcase — libreta → mockup digital, cross-fade en
     loop. El CSS arranca en pausa; este observer solo la reproduce
     mientras el componente está en pantalla (congela el frame al
     salir, no la reinicia).
     ------------------------------------------------------------- */
  function initTransformShowcase() {
    var el = document.querySelector("[data-transform]");
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("is-playing");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        el.classList.toggle("is-playing", entry.isIntersecting);
      });
    }, { threshold: 0.3 });
    io.observe(el);
  }

  /* -------------------------------------------------------------
     Carousel — grid en desktop; en mobile el track hace scroll
     nativo (swipe) y este JS solo sincroniza los puntos activos.
     ------------------------------------------------------------- */
  function initCarousels() {
    $$("[data-carousel-track]").forEach(function (track) {
      var root = track.closest(".carousel");
      if (!root) return;
      var dotsRoot = root.querySelector("[data-carousel-dots]");
      if (!dotsRoot) return;
      var dots = $$(".carousel-dot", dotsRoot);
      if (!dots.length) return;
      var cards = $$(":scope > *", track);
      var ticking = false;
      var activeIndex = 0;

      function updateActive() {
        ticking = false;
        var center = track.scrollLeft + track.clientWidth / 2;
        var closest = 0;
        var closestDist = Infinity;
        cards.forEach(function (card, i) {
          var dist = Math.abs((card.offsetLeft + card.offsetWidth / 2) - center);
          if (dist < closestDist) { closestDist = dist; closest = i; }
        });
        activeIndex = closest;
        dots.forEach(function (dot, i) { dot.classList.toggle("is-active", i === closest); });
      }

      track.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateActive);
      }, { passive: true });
      updateActive();

      /* ---------------------------------------------------------
         Autoplay — opt-in via data-carousel-autoplay (only the
         "Así lo hacemos" steps carousel uses it today). Advances one
         card every AUTOPLAY_MS; once past the last card it scrolls
         straight back to the first ("se regresa al principio") rather
         than looping forward through clones. Stops for good the
         moment the visitor touches/wheels/drags the track themselves
         — same "never fight a manual interaction" rule already used
         for the industries auto-advance — and only runs while the
         carousel is actually on screen, same as initPersonalizacion()'s
         own auto-cycle.
         --------------------------------------------------------- */
      if (track.hasAttribute("data-carousel-autoplay") && !reduced) {
        var AUTOPLAY_MS = 3800;
        var timer = null;
        var userInteracted = false;
        ["pointerdown", "wheel", "touchstart"].forEach(function (evt) {
          track.addEventListener(evt, function () { userInteracted = true; stop(); }, { passive: true });
        });

        function goToIndex(i) {
          var card = cards[i];
          if (!card) return;
          track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: "smooth" });
        }
        function tick() {
          if (userInteracted) return;
          var next = activeIndex + 1 >= cards.length ? 0 : activeIndex + 1;
          goToIndex(next);
        }
        function start() {
          if (timer || userInteracted) return;
          timer = setInterval(tick, AUTOPLAY_MS);
        }
        function stop() {
          clearInterval(timer);
          timer = null;
        }
        if ("IntersectionObserver" in window) {
          var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting) start(); else stop();
            });
          }, { threshold: 0.4 });
          io.observe(root);
        } else {
          start();
        }
      }
    });
  }

  /* -------------------------------------------------------------
     Infinite marquee — duplicate track, CSS drives the animation.
     ------------------------------------------------------------- */
  function initMarquee() {
    var tracks = $$("[data-marquee]");
    tracks.forEach(function (track) {
      if (track.dataset.marqueeBound) return;
      track.dataset.marqueeBound = "1";
      var clone = track.cloneNode(true);
      clone.removeAttribute("data-marquee");
      clone.setAttribute("aria-hidden", "true");
      track.parentNode.appendChild(clone);
    });
  }

  /* -------------------------------------------------------------
     "¿Qué sigue?" step carousel (gracias.html). One centered card at
     a time, looping infinitely (07 -> 01 -> 02... and 01 -> 07
     backwards); native horizontal scroll + scroll-snap drives mobile
     swipe (same technique as initCarousels() above — no custom drag
     code). The loop is the classic "boundary clone" trick: a clone of
     card 07 sits before card 01, and a clone of card 01 sits after
     card 07 (both aria-hidden, data-steps-clone). Stepping onto a
     clone animates normally; once the scroll settles there, it's
     repositioned instantly (behavior:"auto") onto the real card it's
     a copy of, so the jump is invisible. Edge spacers (data-steps-
     spacer) are sized in JS so the first/last card can center too —
     real flex items, not track padding, because a scroll container's
     trailing padding isn't counted in its scrollWidth in every
     browser, which silently capped how far the track could scroll.
     ------------------------------------------------------------- */
  function initStepsCarousel() {
    var viewport = $("[data-steps-viewport]");
    var track = $("[data-steps-track]");
    if (!viewport || !track) return;
    var allCards = $$("[data-steps-card]", track);
    var realCards = $$("[data-steps-card][data-steps-real]", track);
    var spacers = $$("[data-steps-spacer]", track);
    if (realCards.length < 2) return;
    var prevBtn = $("[data-steps-prev]");
    var nextBtn = $("[data-steps-next]");
    var segs = $$("[data-steps-seg]");
    var currentEl = $("[data-steps-current]");

    var REAL_COUNT = realCards.length;
    var LAST_DOM = allCards.length - 1;
    var domIndex = 1; // dom index 0 is the leading clone; real cards occupy 1..REAL_COUNT

    function pad(n) { return (n < 10 ? "0" : "") + n; }

    function realIndexOf(dIdx) {
      if (dIdx <= 0) return REAL_COUNT - 1;
      if (dIdx >= REAL_COUNT + 1) return 0;
      return dIdx - 1;
    }

    function setSpacers() {
      var cardW = allCards[0].getBoundingClientRect().width;
      var side = Math.max(0, (viewport.clientWidth - cardW) / 2);
      spacers.forEach(function (s) { s.style.width = side + "px"; });
    }

    function scrollToDom(dIdx, behavior) {
      var card = allCards[dIdx];
      viewport.scrollTo({ left: card.offsetLeft - (viewport.clientWidth - card.offsetWidth) / 2, behavior: behavior });
    }

    function applyActive(dIdx) {
      var rIdx = realIndexOf(dIdx);
      allCards.forEach(function (card, i) { card.classList.toggle("is-active", i === dIdx); });
      segs.forEach(function (seg, i) { seg.classList.toggle("is-active", i === rIdx); });
      if (currentEl) currentEl.textContent = pad(rIdx + 1);
    }

    function syncFromScrollPosition() {
      var center = viewport.scrollLeft + viewport.clientWidth / 2;
      var closest = domIndex, closestDist = Infinity;
      allCards.forEach(function (card, i) {
        var dist = Math.abs((card.offsetLeft + card.offsetWidth / 2) - center);
        if (dist < closestDist) { closestDist = dist; closest = i; }
      });
      if (closest !== domIndex) {
        domIndex = closest;
        applyActive(domIndex);
      }
    }

    // Resolve the real position only once a scroll gesture (swipe or
    // smooth arrow-scroll) has actually finished — never mid-flight.
    // Reading the live scroll position while a gesture is still animating
    // and feeding it back into domIndex is what caused the previous bug:
    // a button click's own in-flight animation would get overwritten by
    // this same logic reacting to the not-yet-arrived scroll position,
    // corrupting the count. Resting on a clone gets silently snapped to
    // the real card it duplicates.
    function onScrollSettled() {
      syncFromScrollPosition();
      if (domIndex === 0) {
        domIndex = REAL_COUNT;
        scrollToDom(domIndex, "auto");
        applyActive(domIndex);
      } else if (domIndex === LAST_DOM) {
        domIndex = 1;
        scrollToDom(domIndex, "auto");
        applyActive(domIndex);
      }
    }

    if ("onscrollend" in window) {
      viewport.addEventListener("scrollend", onScrollSettled, { passive: true });
    } else {
      var settleTimer = null;
      viewport.addEventListener("scroll", function () {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(onScrollSettled, 150);
      }, { passive: true });
    }

    function step(delta) {
      domIndex = Math.max(0, Math.min(LAST_DOM, domIndex + delta));
      scrollToDom(domIndex, reduced ? "auto" : "smooth");
      applyActive(domIndex);
    }
    if (prevBtn) prevBtn.addEventListener("click", function () { step(-1); restartAutoplay(); });
    if (nextBtn) nextBtn.addEventListener("click", function () { step(1); restartAutoplay(); });

    // Autoplay — advances one card every 3s, same timer pattern as
    // initPersonalizacion() above. Paused (not just not-started) while
    // the carousel is out of view, while the user is actively
    // touching/dragging it (so it never fights a swipe mid-gesture),
    // and entirely skipped under prefers-reduced-motion.
    var AUTOPLAY_MS = 3000;
    var autoplayTimer = null;
    function startAutoplay() {
      if (reduced || autoplayTimer) return;
      autoplayTimer = setInterval(function () { step(1); }, AUTOPLAY_MS);
    }
    function stopAutoplay() {
      if (!autoplayTimer) return;
      clearInterval(autoplayTimer);
      autoplayTimer = null;
    }
    function restartAutoplay() {
      if (reduced) return;
      stopAutoplay();
      startAutoplay();
    }

    if (!reduced) {
      viewport.addEventListener("pointerdown", stopAutoplay, { passive: true });
      viewport.addEventListener("pointerup", startAutoplay, { passive: true });
      viewport.addEventListener("pointercancel", startAutoplay, { passive: true });
      if (fineHover) {
        viewport.addEventListener("mouseenter", stopAutoplay);
        viewport.addEventListener("mouseleave", startAutoplay);
      }
      if ("IntersectionObserver" in window) {
        var autoplayIo = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) startAutoplay(); else stopAutoplay();
          });
        }, { threshold: 0.4 });
        autoplayIo.observe(viewport);
      } else {
        startAutoplay();
      }
    }

    function layout() {
      setSpacers();
      scrollToDom(domIndex, "auto");
      applyActive(domIndex);
    }

    layout();
    window.addEventListener("resize", debounce(layout, 150));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(layout).catch(function () {});
    }
  }

  /* -------------------------------------------------------------
     Subtle tilt on mockup / offer cards — signature micro-interaction
     ------------------------------------------------------------- */
  function initTilt() {
    if (!fineHover) return;
    $$("[data-tilt]").forEach(function (card) {
      var MAX = 5;
      var tx = 0, ty = 0, cx = 0, cy = 0, raf = null;
      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        tx = -py * MAX; ty = px * MAX;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      card.addEventListener("mouseleave", function () {
        tx = 0; ty = 0;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      function loop() {
        cx += (tx - cx) * 0.15;
        cy += (ty - cy) * 0.15;
        card.style.setProperty("--rx", cx.toFixed(2) + "deg");
        card.style.setProperty("--ry", cy.toFixed(2) + "deg");
        raf = (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) ? requestAnimationFrame(loop) : null;
      }
    });
  }

  /* -------------------------------------------------------------
     Hero mockup 3D tilt — cursor-following rotation, fine-hover only
     ------------------------------------------------------------- */
  function initMockupTilt() {
    if (!fineHover) return;
    var wrap = document.querySelector("[data-mockup-tilt]");
    var card = wrap ? wrap.querySelector(".mockup") : null;
    if (!wrap || !card) return;
    wrap.addEventListener("mousemove", function (e) {
      var rect = wrap.getBoundingClientRect();
      var px = (e.clientX - rect.left) / rect.width - 0.5;
      var py = (e.clientY - rect.top) / rect.height - 0.5;
      var ry = px * 14 - 8;
      var rx = py * -10 + 2;
      card.style.transform = "rotateY(" + ry + "deg) rotateX(" + rx + "deg)";
    });
    wrap.addEventListener("mouseover", function (e) {
      if (wrap.contains(e.relatedTarget)) return;
      wrap.classList.add("is-active");
    });
    wrap.addEventListener("mouseout", function (e) {
      if (wrap.contains(e.relatedTarget)) return;
      wrap.classList.remove("is-active");
      card.style.transform = "";
    });
  }

  /* -------------------------------------------------------------
     Generic exclusive accordion group — sección 3b helper
     Opening one item in the group closes any other open item
     in that SAME group. Independent groups don't interfere.
     ------------------------------------------------------------- */
  function bindExclusiveGroup(items, opts) {
    // items: array of { root, trigger, panel }
    // opts.measure: "auto" (generous max-height, no re-measure) | "px" (scrollHeight)
    function close(item) {
      item.root.classList.remove("is-open");
      item.trigger.setAttribute("aria-expanded", "false");
      item.panel.style.maxHeight = opts.measure === "px" ? "0px" : "";
      if (opts.measure !== "px") item.panel.style.removeProperty("--auto-open");
    }
    function open(item) {
      item.root.classList.add("is-open");
      item.trigger.setAttribute("aria-expanded", "true");
      if (opts.measure === "px") {
        item.panel.style.maxHeight = item.panel.scrollHeight + "px";
      }
    }
    items.forEach(function (item) {
      if (item.trigger.dataset.bound) return;
      item.trigger.dataset.bound = "1";
      item.trigger.addEventListener("click", function () {
        var isOpen = item.root.classList.contains("is-open");
        items.forEach(close);
        if (!isOpen) open(item);
      });
    });
    return { items: items, close: close, open: open };
  }

  var accordionGroups = []; // populated by initAccordion, used on resize

  function initAccordion() {
    var target = $("[data-faq-list]");
    if (!target) return;

    // Level 1 — categories (generous max-height, not measured in px;
    // avoids having to re-measure when the nested level changes size)
    var catItems = $$("[data-accordion-cat]", target).map(function (root) {
      return {
        root: root,
        trigger: $(".accordion-cat-trigger", root),
        panel: $(".accordion-cat-panel", root)
      };
    }).filter(function (i) { return i.trigger && i.panel; });
    var catGroup = bindExclusiveGroup(catItems, { measure: "auto" });
    accordionGroups.push(catGroup);

    // Level 2 — questions inside each category (measured in px,
    // no nested level underneath so scrollHeight is reliable)
    $$("[data-accordion]", target).forEach(function (panel) {
      var qItems = $$("[data-faq-item]", panel).map(function (root) {
        return {
          root: root,
          trigger: $(".faq-trigger", root),
          panel: $(".faq-a", root)
        };
      }).filter(function (i) { return i.trigger && i.panel; });
      var qGroup = bindExclusiveGroup(qItems, { measure: "px" });
      accordionGroups.push(qGroup);
    });

    // Reflow — any open px-measured panel recalculates scrollHeight on resize
    window.addEventListener("resize", debounce(function () {
      accordionGroups.forEach(function (group) {
        group.items.forEach(function (item) {
          if (item.root.classList.contains("is-open") && item.panel.style.maxHeight !== "") {
            item.panel.style.maxHeight = item.panel.scrollHeight + "px";
          }
        });
      });
    }, 120));
  }

  /* -------------------------------------------------------------
     Checkout "¿Tienes dudas?" mini-FAQ (checkout.html) — single flat
     level, same accordion-item/.faq-trigger/.faq-a markup and the same
     bindExclusiveGroup() helper as the full FAQ above, just without the
     2-level category wrapper initAccordion() expects. Pushed into the
     same accordionGroups array so that function's resize reflow also
     keeps this one's open panel height correct.
     ------------------------------------------------------------- */
  function initCheckoutFaq() {
    var list = $("[data-checkout-faq-list]");
    if (!list) return;
    var items = $$("[data-faq-item]", list).map(function (root) {
      return { root: root, trigger: $(".faq-trigger", root), panel: $(".faq-a", root) };
    }).filter(function (i) { return i.trigger && i.panel; });
    accordionGroups.push(bindExclusiveGroup(items, { measure: "px" }));

    // initAccordion() normally owns the resize reflow for accordionGroups,
    // but it early-returns on this page (no [data-faq-list] here), so this
    // group needs its own copy of that same reflow registration.
    window.addEventListener("resize", debounce(function () {
      accordionGroups.forEach(function (group) {
        group.items.forEach(function (item) {
          if (item.root.classList.contains("is-open") && item.panel.style.maxHeight !== "") {
            item.panel.style.maxHeight = item.panel.scrollHeight + "px";
          }
        });
      });
    }, 120));
  }

  /* -------------------------------------------------------------
     Checkout país/ciudad — custom-styled, searchable comboboxes
     (checkout.html). Built from scratch instead of native <select>
     because a native dropdown's open list is drawn by the OS/browser
     and can't be reliably themed with the brand's font/colors across
     browsers (Safari in particular ignores almost all of it). Data
     comes from lib/geo-data.js, no external API calls.

     buildCombo() is the generic widget engine (trigger button + a
     panel with a search box and a filtered listbox); initCheckoutGeo()
     wires up one instance for country and one for city. City's dataset
     only covers major cities per country, so its list always carries a
     trailing "Otra ciudad / Other city" item that reveals a free-text
     fallback input. Either way the real submitted value is mirrored
     into hidden input[data-field="country"/"city"], since that's what
     lib/checkout.js's validate()/payload code reads.
     ------------------------------------------------------------- */
  function buildCombo(root, onChange) {
    var trigger = $("[data-combo-trigger]", root);
    var label = $("[data-combo-trigger-label]", root);
    var panel = $("[data-combo-panel]", root);
    var search = $("[data-combo-search]", root);
    var list = $("[data-combo-list]", root);
    if (!trigger || !label || !panel || !search || !list) return null;

    var items = [];
    var filtered = [];
    var selectedValue = "";
    var activeIndex = -1;
    var placeholderText = "";
    var noResultsText = "";

    function setActive(index) {
      var opts = $$(".checkout-combo-option", list);
      opts.forEach(function (el) { el.classList.remove("is-active"); });
      activeIndex = index;
      if (index >= 0 && opts[index]) {
        opts[index].classList.add("is-active");
        opts[index].scrollIntoView({ block: "nearest" });
      }
    }

    function choose(it) {
      selectedValue = it.value;
      label.textContent = it.text;
      label.classList.remove("is-placeholder");
      close();
      trigger.focus();
      if (onChange) onChange(it);
    }

    function renderList() {
      var q = search.value.trim().toLowerCase();
      list.innerHTML = "";
      filtered = items.filter(function (it) {
        return !q || it.text.toLowerCase().indexOf(q) !== -1;
      });
      if (!filtered.length) {
        var empty = document.createElement("li");
        empty.className = "checkout-combo-empty";
        empty.textContent = noResultsText;
        list.appendChild(empty);
        activeIndex = -1;
        return;
      }
      filtered.forEach(function (it) {
        var li = document.createElement("li");
        li.className = "checkout-combo-option";
        li.setAttribute("role", "option");
        if (it.value === selectedValue) {
          li.classList.add("is-selected");
          li.setAttribute("aria-selected", "true");
        }
        li.textContent = it.text;
        li.addEventListener("mousedown", function (e) {
          e.preventDefault(); // keep focus in the search field until the click registers
          choose(it);
        });
        list.appendChild(li);
      });
      activeIndex = -1;
    }

    function onDocClick(e) {
      if (!root.contains(e.target)) close();
    }

    function open() {
      if (trigger.disabled || !panel.hidden) return;
      panel.hidden = false;
      root.setAttribute("data-open", "true");
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      renderList();
      search.focus();
      document.addEventListener("click", onDocClick, true);
    }

    function close() {
      panel.hidden = true;
      root.removeAttribute("data-open");
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
    }

    trigger.addEventListener("click", function () {
      if (panel.hidden) open(); else close();
    });
    trigger.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" && panel.hidden) { e.preventDefault(); open(); }
    });

    search.addEventListener("input", renderList);
    search.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length) setActive(Math.min(activeIndex + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length) setActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        var idx = activeIndex >= 0 ? activeIndex : (filtered.length === 1 ? 0 : -1);
        if (idx >= 0 && filtered[idx]) choose(filtered[idx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
        trigger.focus();
      }
    });

    return {
      setItems: function (newItems) { items = newItems; },
      setSelected: function (value, text) {
        selectedValue = value;
        label.textContent = text;
        label.classList.remove("is-placeholder");
      },
      setPlaceholder: function (text) {
        placeholderText = text;
        if (!selectedValue) {
          label.textContent = placeholderText;
          label.classList.add("is-placeholder");
        }
      },
      setSearchPlaceholder: function (text) { search.placeholder = text; },
      setNoResultsText: function (text) { noResultsText = text; },
      setDisabled: function (flag) {
        trigger.disabled = flag;
        if (flag) close();
      },
      clear: function () { selectedValue = ""; },
      getValue: function () { return selectedValue; },
      close: close
    };
  }

  function initCheckoutGeo() {
    var countryRoot = $("[data-geo-country]");
    var cityRoot = $("[data-geo-city]");
    var cityOtherInput = $("[data-geo-city-other]");
    var cityOtherBox = $("[data-geo-city-other-box]");
    var countryHidden = $('input[type="hidden"][data-field="country"]');
    var cityHidden = $('input[type="hidden"][data-field="city"]');
    if (!countryRoot || !cityRoot || !cityOtherInput || !countryHidden || !cityHidden) return;

    var GEO = window.__GEO__ || { countries: [], cities: {} };
    var OTHER_VALUE = "__other__";
    var selectedCountryCode = "";

    function countryLabel(c) { return currentLang === "en" ? c.en : c.es; }

    function setHiddenValue(hiddenInput, value) {
      hiddenInput.value = value;
      hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
      hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function setCityOtherVisible(visible) {
      cityOtherInput.hidden = !visible;
      if (cityOtherBox) cityOtherBox.hidden = !visible;
    }

    var countryCombo = buildCombo(countryRoot, function (it) {
      selectedCountryCode = it.code;
      setHiddenValue(countryHidden, it.value);
      populateCity();
      setCityOtherVisible(false);
      cityOtherInput.value = "";
      setHiddenValue(cityHidden, "");
    });

    var cityCombo = buildCombo(cityRoot, function (it) {
      if (it.value === OTHER_VALUE) {
        setCityOtherVisible(true);
        cityOtherInput.value = "";
        setHiddenValue(cityHidden, "");
        cityOtherInput.focus();
      } else {
        setCityOtherVisible(false);
        cityOtherInput.value = "";
        setHiddenValue(cityHidden, it.value);
      }
    });

    if (!countryCombo || !cityCombo) return;

    function populateCountries() {
      var sorted = GEO.countries.slice().sort(function (a, b) {
        return countryLabel(a).localeCompare(countryLabel(b));
      });
      countryCombo.setItems(sorted.map(function (c) {
        return { value: countryLabel(c), text: countryLabel(c), code: c.code };
      }));
      countryCombo.setSearchPlaceholder(t("checkout.field.countrySearchPlaceholder"));
      countryCombo.setNoResultsText(t("checkout.field.comboNoResults"));
      if (selectedCountryCode) {
        var match = sorted.filter(function (c) { return c.code === selectedCountryCode; })[0];
        if (match) {
          countryCombo.setSelected(countryLabel(match), countryLabel(match));
          setHiddenValue(countryHidden, countryLabel(match));
        }
      } else {
        countryCombo.setPlaceholder(t("checkout.field.countryPlaceholder"));
      }
    }

    // preserveValue: a city name to keep selected (language refresh), or
    // OTHER_VALUE to keep the "otra ciudad" branch open, or omitted/null
    // to reset (a genuine country change).
    function populateCity(preserveValue) {
      var cities = (GEO.cities && GEO.cities[selectedCountryCode]) || [];
      var items = cities.map(function (name) { return { value: name, text: name }; });
      items.push({ value: OTHER_VALUE, text: t("checkout.field.cityOther") });
      cityCombo.setItems(items);
      cityCombo.setSearchPlaceholder(t("checkout.field.citySearchPlaceholder"));
      cityCombo.setNoResultsText(t("checkout.field.comboNoResults"));
      cityCombo.setDisabled(!selectedCountryCode);

      var match = preserveValue && items.filter(function (it) { return it.value === preserveValue; })[0];
      if (match) {
        cityCombo.setSelected(match.value, match.text);
        return;
      }
      cityCombo.clear();
      cityCombo.setPlaceholder(selectedCountryCode ? t("checkout.field.cityPlaceholder") : t("checkout.field.cityPlaceholderLocked"));
    }

    cityOtherInput.addEventListener("input", function () {
      setHiddenValue(cityHidden, cityOtherInput.value);
    });

    populateCountries();
    populateCity();

    refreshCheckoutGeoLabels = function () {
      var preserveCity = cityCombo.getValue() || null;
      populateCountries();
      populateCity(preserveCity);
    };
  }

  /* -------------------------------------------------------------
     Checkout phone field's country/lada picker (checkout.html) — a
     small flag + dial-code combobox glued to the left of the phone
     number input. Purely cosmetic: it never writes to
     input[data-field="phone"] — that field's value, and everything
     lib/checkout.js does with it, is untouched. Flags are derived from
     each ISO code via the regional-indicator emoji trick (no flag
     image assets needed); dial codes come from lib/geo-data.js's
     dialCodes map.
     ------------------------------------------------------------- */
  function initCheckoutPhone() {
    var root = $("[data-phone-combo]");
    if (!root) return;
    var trigger = $("[data-phone-trigger]", root);
    var flagEl = $("[data-phone-flag]", root);
    var dialEl = $("[data-phone-dial]", root);
    var panel = $("[data-phone-panel]", root);
    var search = $("[data-phone-search]", root);
    var list = $("[data-phone-list]", root);
    if (!trigger || !flagEl || !dialEl || !panel || !search || !list) return;

    var GEO = window.__GEO__ || { countries: [], dialCodes: {} };

    // flagcdn.com — a free, key-less flag CDN (same visual idea as the
    // nav's own ES/EN SVG flags, just not hand-drawable at this
    // country count); renders an actual flag everywhere, unlike emoji
    // flags which some Windows/Chromium combinations show as letters.
    function flagUrl(code) { return "https://flagcdn.com/" + code.toLowerCase() + ".svg"; }

    var items = GEO.countries
      .filter(function (c) { return GEO.dialCodes[c.code]; })
      .map(function (c) { return { code: c.code, country: c, dial: GEO.dialCodes[c.code], flag: flagUrl(c.code) }; });

    function labelFor(it) { return currentLang === "en" ? it.country.en : it.country.es; }
    function sorted() { return items.slice().sort(function (a, b) { return labelFor(a).localeCompare(labelFor(b)); }); }

    var filtered = [];
    var activeIndex = -1;

    function setActive(index) {
      var opts = $$(".checkout-phone-option", list);
      opts.forEach(function (el) { el.classList.remove("is-active"); });
      activeIndex = index;
      if (index >= 0 && opts[index]) {
        opts[index].classList.add("is-active");
        opts[index].scrollIntoView({ block: "nearest" });
      }
    }

    function choose(it) {
      flagEl.src = it.flag;
      dialEl.textContent = it.dial;
      close();
      trigger.focus();
    }

    function renderList() {
      var q = search.value.trim().toLowerCase();
      filtered = sorted().filter(function (it) {
        return !q || labelFor(it).toLowerCase().indexOf(q) !== -1 || it.dial.indexOf(q) !== -1;
      });
      list.innerHTML = "";
      if (!filtered.length) {
        var empty = document.createElement("li");
        empty.className = "checkout-combo-empty";
        empty.textContent = t("checkout.field.comboNoResults");
        list.appendChild(empty);
        activeIndex = -1;
        return;
      }
      filtered.forEach(function (it) {
        var li = document.createElement("li");
        li.className = "checkout-combo-option checkout-phone-option";
        li.setAttribute("role", "option");
        var flagSpan = document.createElement("img");
        flagSpan.className = "checkout-phone-option-flag";
        flagSpan.src = it.flag;
        flagSpan.alt = "";
        var nameSpan = document.createElement("span");
        nameSpan.className = "checkout-phone-option-name";
        nameSpan.textContent = labelFor(it);
        var dialSpan = document.createElement("span");
        dialSpan.className = "checkout-phone-option-dial";
        dialSpan.textContent = it.dial;
        li.appendChild(flagSpan);
        li.appendChild(nameSpan);
        li.appendChild(dialSpan);
        li.addEventListener("mousedown", function (e) { e.preventDefault(); choose(it); });
        list.appendChild(li);
      });
      activeIndex = -1;
    }

    function onDocClick(e) { if (!root.contains(e.target)) close(); }

    function open() {
      if (!panel.hidden) return;
      panel.hidden = false;
      root.setAttribute("data-open", "true");
      trigger.setAttribute("aria-expanded", "true");
      search.value = "";
      renderList();
      search.focus();
      document.addEventListener("click", onDocClick, true);
    }
    function close() {
      panel.hidden = true;
      root.removeAttribute("data-open");
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
    }

    trigger.addEventListener("click", function () { if (panel.hidden) open(); else close(); });
    trigger.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" && panel.hidden) { e.preventDefault(); open(); }
    });

    search.addEventListener("input", renderList);
    search.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (filtered.length) setActive(Math.min(activeIndex + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (filtered.length) setActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        var idx = activeIndex >= 0 ? activeIndex : (filtered.length === 1 ? 0 : -1);
        if (idx >= 0 && filtered[idx]) choose(filtered[idx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
        trigger.focus();
      }
    });

    search.placeholder = t("checkout.field.phoneSearchPlaceholder");
    refreshCheckoutPhoneLabels = function () {
      search.placeholder = t("checkout.field.phoneSearchPlaceholder");
      if (!panel.hidden) renderList();
    };
  }

  /* -------------------------------------------------------------
     Checkout mobile step wizard (checkout.html) — below the 899px
     breakpoint where the two-column layout stacks into one, the three
     panels (Tu información / Resumen de compra / Completa tu compra)
     become a true one-at-a-time flow instead of all sitting open:
     only the current step's panel is shown (the other two are fully
     hidden, not just visually collapsed), with a progress stepper
     above indicating 1 → 2 → 3, the current step highlighted,
     finished ones checked off and dimmed ones still ahead.

       - Step 1 → 2: its own "Continuar" button, gated on the same
         required fields lib/checkout.js's validate() checks (name,
         email, phone, business, country, city). Incomplete shows an
         inline error instead of advancing.
       - Step 2 → 3: its own "Continuar al pago" button (step 2 has
         nothing to validate, it's read-only review content).
       - Step 3: the existing "Continuar al pago" button is untouched —
         it still runs lib/checkout.js's real validate()/submit/Whop
         flow; this module only adds a "Volver" to step 2 next to it.
       - "Volver" on steps 2 and 3 goes back one step. Nothing is ever
         cleared when a step is hidden, so going back and forward keeps
         every field's value.

     Desktop (> 899px) is untouched — this only ever toggles the
     .is-step-active class (and the stepper's state classes) the CSS
     hides behind the max-width: 899px media query, and the
     mediaquery listener below clears all of it if the viewport grows
     past that breakpoint.
     ------------------------------------------------------------- */
  function initCheckoutSteps() {
    var roots = $$("[data-checkout-step]");
    if (roots.length < 3) return;

    var panels = roots; // index 0/1/2 = step 1/2/3, in DOM order
    var gridEl = $(".checkout-grid");
    var mainEl = $(".checkout-main");
    var sideEl = $(".checkout-side");
    var stepper = $("[data-checkout-stepper]");
    var stepperItems = stepper ? $$("[data-stepper-item]", stepper) : [];
    var stepperConnectors = stepper ? $$("[data-stepper-connector]", stepper) : [];

    // On mobile (single column) the main/side columns fully swap: step 3
    // takes over the whole screen and the form/summary column hides.
    // On desktop (two columns) the side column (step 3) stays visible as
    // a persistent summary sidebar next to whichever main step is open —
    // see the `.checkout-panel[data-checkout-step="3"]` override and
    // `.checkout-step3-actions` gating in styles.css.
    var mq = matchMedia("(max-width: 899px)");
    function isMobile() { return mq.matches; }

    var currentStep = 1;

    function render() {
      panels.forEach(function (panel, i) {
        panel.classList.toggle("is-step-active", i === currentStep - 1);
      });
      if (mainEl) mainEl.style.display = currentStep === 3 ? "none" : "";
      if (sideEl) sideEl.style.display = isMobile() && currentStep !== 3 ? "none" : "";
      if (gridEl) gridEl.classList.toggle("checkout-grid-step3", currentStep === 3);
      stepperItems.forEach(function (item) {
        var n = parseInt(item.getAttribute("data-stepper-item"), 10);
        item.classList.toggle("is-active", n === currentStep);
        item.classList.toggle("is-complete", n < currentStep);
      });
      stepperConnectors.forEach(function (connector) {
        var n = parseInt(connector.getAttribute("data-stepper-connector"), 10);
        connector.classList.toggle("is-filled", n < currentStep);
      });
    }

    function goToStep(n, opts) {
      currentStep = n;
      render();
      if (!opts || opts.scroll !== false) {
        (stepper || panels[n - 1]).scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      }
    }

    render();
    if (mq.addEventListener) mq.addEventListener("change", function () { render(); });
    else if (mq.addListener) mq.addListener(function () { render(); });

    // Completed stepper steps double as back-navigation shortcuts.
    stepperItems.forEach(function (item) {
      var n = parseInt(item.getAttribute("data-stepper-item"), 10);
      item.addEventListener("click", function () {
        if (n >= currentStep) return;
        goToStep(n);
      });
    });

    $$('[data-checkout-step-back]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        goToStep(parseInt(btn.getAttribute("data-checkout-step-back"), 10) - 1);
      });
    });

    /* Step 1 -> 2 */
    var REQUIRED_STEP1_FIELDS = ["name", "email", "phone", "business", "country", "city"];
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    var step1Fields = REQUIRED_STEP1_FIELDS.map(function (key) {
      return $('[data-field="' + key + '"]', panels[0]);
    }).filter(Boolean);
    var step1ContinueBtn = $("[data-checkout-step1-continue]", panels[0]);
    var step1Error = $("[data-checkout-step1-error]", panels[0]);

    function step1Complete() {
      var vals = {};
      step1Fields.forEach(function (el) { vals[el.getAttribute("data-field")] = el.value.trim(); });
      return !!(vals.name && EMAIL_RE.test(vals.email || "") && vals.phone && vals.business && vals.country && vals.city);
    }

    if (step1ContinueBtn) {
      step1ContinueBtn.addEventListener("click", function () {
        if (!step1Complete()) {
          if (step1Error) step1Error.textContent = t("checkout.step1.incomplete");
          return;
        }
        if (step1Error) step1Error.textContent = "";
        goToStep(2);
      });
    }
    if (step1Error) {
      step1Fields.forEach(function (el) {
        el.addEventListener("input", function () { step1Error.textContent = ""; });
        el.addEventListener("change", function () { step1Error.textContent = ""; });
      });
    }

    // Per-field micro-feedback (name/email/phone/business only — country/
    // city are comboboxes with their own selected-state affordance): a
    // small check fades in once a field validates on blur, and a gentle
    // border-color shift (no shake) flags it once the visitor has left an
    // invalid one. Purely presentational — doesn't affect step1Complete().
    var STEP1_CHECK_FIELDS = ["name", "email", "phone", "business"];
    function step1FieldValid(el) {
      var key = el.getAttribute("data-field");
      var val = el.value.trim();
      if (key === "email") return EMAIL_RE.test(val);
      return !!val;
    }
    step1Fields
      .filter(function (el) { return STEP1_CHECK_FIELDS.indexOf(el.getAttribute("data-field")) !== -1; })
      .forEach(function (el) {
        var wrap = el.closest(".checkout-field-boxed");
        if (!wrap) return;
        function refresh(touched) {
          var valid = step1FieldValid(el);
          wrap.classList.toggle("is-valid", valid);
          if (touched) wrap.classList.toggle("is-invalid", !valid);
        }
        el.addEventListener("blur", function () { refresh(true); });
        el.addEventListener("input", function () {
          if (wrap.classList.contains("is-invalid") || wrap.classList.contains("is-valid")) refresh(true);
        });
      });

    /* Step 2 -> 3 — nothing to validate, just advance. */
    var step2ContinueBtn = $("[data-checkout-step2-continue]", panels[1]);
    if (step2ContinueBtn) {
      step2ContinueBtn.addEventListener("click", function () {
        goToStep(3);
      });
    }
  }

  /* -------------------------------------------------------------
     FAB tooltips (FAQ + WhatsApp) — sección 3a
     Tooltip text shows only after IDLE_DELAY of no scroll;
     hides immediately on scroll. One scroll listener drives all items.

     data-fab-no-idle (opt-in, e.g. gracias.html): the idle/scroll
     auto-show is skipped — the page has content (the "¿Qué sigue?"
     timeline) the tooltip's left-extending text can cover when it pops
     up unprompted, so tooltips there only ever appear from a real
     hover/focus interaction.
     ------------------------------------------------------------- */
  function initFabTooltips() {
    var stack = $("[data-fab-stack]");
    if (!stack) return;
    var items = $$("[data-fab-item]", stack);
    if (!items.length) return;

    if (stack.hasAttribute("data-fab-no-idle")) {
      items.forEach(function (i) {
        i.addEventListener("mouseenter", function () { i.classList.add("show-tooltip"); });
        i.addEventListener("mouseleave", function () { i.classList.remove("show-tooltip"); });
        i.addEventListener("focus", function () { i.classList.add("show-tooltip"); });
        i.addEventListener("blur", function () { i.classList.remove("show-tooltip"); });
      });
      return;
    }

    var IDLE_DELAY = 1100;
    var idleTimer = null;

    function showTooltips() {
      items.forEach(function (i) { i.classList.add("show-tooltip"); });
    }
    function hideTooltips() {
      items.forEach(function (i) { i.classList.remove("show-tooltip"); });
    }
    function scheduleIdle() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(showTooltips, IDLE_DELAY);
    }

    window.addEventListener("scroll", function () {
      hideTooltips();
      scheduleIdle();
    }, { passive: true });

    items.forEach(function (i) {
      i.addEventListener("focus", showTooltips);
      i.addEventListener("blur", hideTooltips);
    });

    scheduleIdle();
  }

  /* -------------------------------------------------------------
     Cookie consent gate — blocks interaction with the rest of the
     page (a full-screen backdrop above nav/cta-bar/FAB stack, plus a
     locked body scroll) until "Entendido" is clicked. On purpose,
     there's no backdrop-click or Escape dismissal — the button is the
     only way past it. This is still an "accept to dismiss" notice, not
     a real opt-in/opt-out consent manager: every tracker on the site
     (Meta Pixel, Whop) already loads regardless of this gate. The
     choice is remembered in localStorage so it doesn't reappear on
     every visit. Present on both index.html and politica-cookies.html.
     ------------------------------------------------------------- */
  var COOKIE_STORAGE_KEY = "deec_cookie_consent";
  var analyticsLoaded = false;

  function readCookieConsent() {
    try {
      var raw = window.localStorage.getItem(COOKIE_STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return (parsed && typeof parsed.analytics === "boolean") ? parsed : null;
    } catch (err) { return null; }
  }
  function writeCookieConsent(analytics) {
    try { window.localStorage.setItem(COOKIE_STORAGE_KEY, JSON.stringify({ analytics: analytics })); } catch (err) {}
  }

  // Official Whop + Meta Pixel bootstrap snippets — byte-identical logic
  // to what used to sit inline in index.html/politica-cookies.html's
  // <head>, just moved into a function so they only run once consent is
  // actually given instead of unconditionally on every page load. Only
  // called from initCookieConsent() below, and at most once per page
  // view (analyticsLoaded guard) since both snippets install their own
  // globals (window.whop / window.fbq) the moment they run.
  function loadAnalyticsTracking() {
    if (analyticsLoaded) return;
    analyticsLoaded = true;
    try {
      (function (w, d, s, u, n, a, b) {
        if (w[n]) return;
        a = w[n] = {
          q: [], t: +new Date, s: [], o: u,
          track: function () { a.q.push([+new Date].concat([].slice.call(arguments))); },
          setScope: function () {
            a.s = [].slice.call(arguments).filter(function (x) { return typeof x === "string"; });
            a.q.push([+new Date, "setScope"].concat(a.s));
          },
          scope: function () {
            var c = [].slice.call(arguments);
            return { track: function () { a.q.push([+new Date].concat([].slice.call(arguments)).concat([{ __scope: c }])); } };
          }
        };
        b = d.createElement(s);
        b.async = 1;
        b.src = u + "/s.js";
        d.getElementsByTagName(s)[0].parentNode.insertBefore(b, d.getElementsByTagName(s)[0]);
      })(window, document, "script", "https://t.whop.tw", "whop");
      window.whop.setScope("biz_z27YXAf3J61uO9");
      window.whop.track("page");
    } catch (err) { if (window.console) console.warn("[whop tracking]", err); }

    try {
      (function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n;
        n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
        t = b.createElement(e); t.async = true; t.src = v;
        s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", "1068830012634174");
      window.fbq("track", "PageView");
    } catch (err) { if (window.console) console.warn("[fbq init]", err); }
  }

  /* -------------------------------------------------------------
     Cookie consent modal — blocks interaction with the rest of the
     page (backdrop above nav/cta-bar/FAB stack + locked body scroll)
     until a decision is made. There is NO way to dismiss it without
     picking one of the two real choices — no close button, no
     backdrop-click, no Escape. "Aceptar todas" and "Guardar
     preferencias" (with the toggle on) are what actually call
     loadAnalyticsTracking() above; leaving the toggle off and saving
     means Meta Pixel/Whop never load this session. Once a choice
     exists, the modal only reopens from the footer's "Preferencias de
     cookies" (data-cookie-reopen), pre-filled with the stored choice
     so it can be changed anytime — reopening still requires picking
     Aceptar todas or Guardar preferencias again to close it.
     ------------------------------------------------------------- */
  function initCookieConsent() {
    var modal = $("[data-cookie-banner]");
    var backdrop = $("[data-cookie-banner-backdrop]");
    if (!modal) return;
    var customizeBtn = $("[data-cookie-customize]", modal);
    var acceptAllBtn = $("[data-cookie-accept-all]", modal);
    var saveBtn = $("[data-cookie-save]", modal);
    var analyticsToggle = $("[data-cookie-toggle-analytics]", modal);
    var choiceStep = $('[data-cookie-step="choice"]', modal);
    var prefsStep = $('[data-cookie-step="prefs"]', modal);
    var reopenBtns = $$("[data-cookie-reopen]");

    var analyticsOn = false; // in-modal toggle state, separate from what's stored/loaded until Save/Accept

    function setToggle(on) {
      analyticsOn = on;
      if (!analyticsToggle) return;
      analyticsToggle.classList.toggle("is-on", on);
      analyticsToggle.setAttribute("aria-checked", on ? "true" : "false");
    }
    function showChoiceStep() {
      if (choiceStep) choiceStep.hidden = false;
      if (prefsStep) prefsStep.hidden = true;
    }
    function showPrefsStep() {
      if (choiceStep) choiceStep.hidden = true;
      if (prefsStep) prefsStep.hidden = false;
    }

    function open() {
      var stored = readCookieConsent();
      setToggle(stored ? stored.analytics : false);
      showChoiceStep();
      modal.hidden = false;
      if (backdrop) backdrop.hidden = false;
      document.body.style.overflow = "hidden";
      // Forced reflow instead of requestAnimationFrame — see the menu
      // panel's open() above for why (throttled rAF can leave it stuck
      // invisible instead of fading in).
      void modal.offsetHeight;
      modal.classList.add("is-visible");
      if (backdrop) backdrop.classList.add("is-visible");
    }
    function close(analytics) {
      writeCookieConsent(analytics);
      if (analytics) loadAnalyticsTracking();
      modal.classList.remove("is-visible");
      if (backdrop) backdrop.classList.remove("is-visible");
      document.body.style.overflow = "";
      setTimeout(function () {
        modal.hidden = true;
        if (backdrop) backdrop.hidden = true;
      }, 300);
    }

    if (customizeBtn) customizeBtn.addEventListener("click", showPrefsStep);
    if (analyticsToggle) analyticsToggle.addEventListener("click", function () { setToggle(!analyticsOn); });
    if (acceptAllBtn) acceptAllBtn.addEventListener("click", function () { close(true); });
    if (saveBtn) saveBtn.addEventListener("click", function () { close(analyticsOn); });
    reopenBtns.forEach(function (btn) { btn.addEventListener("click", open); });

    var stored = readCookieConsent();
    if (stored) {
      if (stored.analytics) loadAnalyticsTracking();
      return; // already decided on a past visit — don't show the modal on load
    }
    open();
  }

  /* -------------------------------------------------------------
     Social proof / visitor toasts — sección 5b
     ⚠️ Datos de demostración salvo que socialProof.isDemoData === false
     ------------------------------------------------------------- */
  var SP_CONFIG = {
    visibleMs: 5000,
    firstDelayMs: 6000,
    gapMinMs: 14000,
    gapMaxMs: 24000
  };
  var SP_ICONS = {
    visitors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    purchase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/><path d="M1 1h3l2.4 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L21 6H5"/><path d="M14 9l2 2 4-4"/></svg>'
  };
  var STAR_PATH = "M10 1.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L1.3 7.8l6.1-.7L10 1.5Z";
  function starsSvg(instanceId) {
    // 4 estrellas llenas (100%) + 1 con relleno parcial fijo al 80% vía gradiente
    var full = '<svg viewBox="0 0 20 20"><path fill="currentColor" d="' + STAR_PATH + '"/></svg>';
    var gradId = "starFill-" + instanceId;
    var partial =
      '<svg viewBox="0 0 20 20"><defs><linearGradient id="' + gradId + '">' +
      '<stop offset="80%" stop-color="currentColor"/><stop offset="80%" stop-color="transparent"/>' +
      "</linearGradient></defs>" +
      '<path fill="url(#' + gradId + ')" stroke="currentColor" stroke-width="1" stroke-linejoin="round" d="' + STAR_PATH + '"/></svg>';
    return full + full + full + full + partial;
  }

  /* -------------------------------------------------------------
     Rating stars — Hero + Oferta (sección 2.2). Always 5 stars:
     4 full + 1 at a fixed 80% fill, independent of the score shown.
     ------------------------------------------------------------- */
  function mountRatingStars() {
    $$("[data-rating-stars]").forEach(function (el) {
      if (el.dataset.mounted) return;
      el.dataset.mounted = "1";
      el.innerHTML = starsSvg(el.getAttribute("data-rating-stars"));
    });
  }

  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function fillTemplate(str, map) {
    return str.replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : ""; });
  }

  function initSocialProof() {
    var stack = $("[data-sp-stack]");
    if (!stack) return;
    var sp = data.socialProof;
    if (!sp || !sp.names || !sp.names.length) return;

    var lastType = null;

    function nextType() {
      var types = ["visitors", "purchase", "rating"].filter(function (ty) { return ty !== lastType; });
      var type = pickRandom(types);
      lastType = type;
      return type;
    }

    var lastCountry = null;
    function nextLocation() {
      var locations = sp.locations || [];
      if (!locations.length) return null;
      var pool = locations.filter(function (loc) { return loc.country !== lastCountry; });
      var loc = pickRandom(pool.length ? pool : locations);
      lastCountry = loc.country;
      return loc;
    }

    // Data (type/name/location/count) is picked once per toast; the text is
    // rebuilt from that same data whenever the language changes, so a
    // relanguage doesn't also reroll which toast is showing.
    var currentState = null;
    function pickState(type) {
      if (type === "visitors") return { type: type, count: pickRandom(sp.visitorCounts || [3]) };
      if (type === "purchase") return { type: type, name: pickRandom(sp.names), loc: nextLocation() };
      return { type: type };
    }

    function buildMessage(state) {
      if (state.type === "visitors") {
        return {
          icon: SP_ICONS.visitors,
          text: fillTemplate(t("socialproof.visitors"), { count: state.count }),
          meta: ""
        };
      }
      if (state.type === "purchase") {
        var product = t("socialproof.product") || sp.product || data.name;
        return {
          icon: SP_ICONS.purchase,
          text: fillTemplate(t("socialproof.purchase"), { name: state.name, city: state.loc ? state.loc.city : "", product: product }),
          meta: t("socialproof.timeAgo")
        };
      }
      return { isRating: true, score: sp.rating || 4.8, text: t("socialproof.ratingText") };
    }

    // Rebuilds the toast markup from currentState in the current language.
    // Used both to mount a fresh toast and to retranslate one already on
    // screen — the second case must NOT touch the is-visible class/timers.
    function renderToast() {
      var msg = buildMessage(currentState);
      var wasVisible = !!$("[data-sp-toast].is-visible", stack);

      if (msg.isRating) {
        // sección 2.4 — reutiliza la estructura .hero-rating-lead del Hero/Oferta
        stack.innerHTML =
          '<div class="sp-toast is-rating' + (wasVisible ? " is-visible" : "") + '" data-sp-toast>' +
            '<div class="sp-toast-body">' +
              '<span class="hero-rating-lead">' +
                '<span class="hero-rating-stars" aria-hidden="true">' + starsSvg("toast") + "</span>" +
                '<strong class="hero-rating-score">' + msg.score + "</strong>" +
              "</span>" +
              "<p>" + msg.text + "</p>" +
            "</div>" +
          "</div>";
      } else {
        stack.innerHTML =
          '<div class="sp-toast' + (wasVisible ? " is-visible" : "") + '" data-sp-toast>' +
            '<span class="sp-toast-icon">' + msg.icon + "</span>" +
            '<span class="sp-toast-body">' +
              "<span class=\"sp-toast-text\">" + msg.text + "</span>" +
              (msg.meta ? '<span class="sp-toast-meta">' + msg.meta + "</span>" : "") +
            "</span>" +
          "</div>";
      }
    }

    function showSpToast() {
      currentState = pickState(nextType());
      renderToast();
      // Forced reflow instead of requestAnimationFrame — see the menu
      // panel's open() above for why (throttled rAF can leave the toast
      // stuck invisible instead of transitioning in).
      var node = $("[data-sp-toast]", stack);
      if (node) {
        void node.offsetHeight;
        node.classList.add("is-visible");
      }

      // Re-query on fire rather than closing over the node renderToast()
      // returned — a language switch while this toast is visible replaces
      // it with a new element (see refreshSocialProofToast), and this timer
      // must fade out whichever element is actually live, not the stale one.
      setTimeout(function () {
        var node = $("[data-sp-toast]", stack);
        if (node) node.classList.remove("is-visible");
        setTimeout(scheduleNext, 250);
      }, SP_CONFIG.visibleMs);
    }

    function scheduleNext() {
      var gap = SP_CONFIG.gapMinMs + Math.random() * (SP_CONFIG.gapMaxMs - SP_CONFIG.gapMinMs);
      setTimeout(showSpToast, gap);
    }

    setTimeout(showSpToast, SP_CONFIG.firstDelayMs);

    refreshSocialProofToast = function () {
      if (!currentState) return;
      if (!$("[data-sp-toast].is-visible", stack)) return;
      renderToast();
    };
  }

  /* -------------------------------------------------------------
     Boot
     ------------------------------------------------------------- */
  function boot() {
    safe(initFontStylesheets, "initFontStylesheets");
    safe(initWhatsapp, "initWhatsapp");
    safe(initNav, "initNav");
    safe(initNavHeight, "initNavHeight");
    safe(initMenuPanel, "initMenuPanel");
    safe(initSmoothAnchors, "initSmoothAnchors");
    safe(initFooterAccordion, "initFooterAccordion");
    safe(initLegalVersioning, "initLegalVersioning");
    safe(initReveals, "initReveals");
    safe(initTransformShowcase, "initTransformShowcase");
    safe(initPersonalizacion, "initPersonalizacion");
    safe(initMarquee, "initMarquee");
    safe(initStepsCarousel, "initStepsCarousel");
    safe(initCarousels, "initCarousels");
    safe(initTilt, "initTilt");
    safe(initMockupTilt, "initMockupTilt");
    safe(initAccordion, "initAccordion");
    safe(initCheckoutFaq, "initCheckoutFaq");
    safe(initCheckoutGeo, "initCheckoutGeo");
    safe(initCheckoutPhone, "initCheckoutPhone");
    safe(initCheckoutSteps, "initCheckoutSteps");
    safe(initFabTooltips, "initFabTooltips");
    safe(initCookieConsent, "initCookieConsent");
    safe(mountRatingStars, "mountRatingStars");
    safe(initSocialProof, "initSocialProof");
    safe(initLangToggle, "initLangToggle");
    document.documentElement.classList.add("is-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
