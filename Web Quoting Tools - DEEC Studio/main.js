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

    // Message follows the page's current language (i18n) — the phone
    // number itself doesn't, that's fixed business config in manifest.js.
    function buildHref() {
      return configured
        ? "https://wa.me/" + wa.number.replace(/\D/g, "") + "?text=" + encodeURIComponent(t("whatsapp.message"))
        : "#";
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
  }

  function initLangToggle() {
    var buttons = $$("[data-lang]");
    if (!buttons.length) return;
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var lang = btn.getAttribute("data-lang");
        if (lang === currentLang) return;
        currentLang = lang;
        applyLanguage();
      });
    });
    applyLanguage();
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

      function updateActive() {
        ticking = false;
        var center = track.scrollLeft + track.clientWidth / 2;
        var closest = 0;
        var closestDist = Infinity;
        cards.forEach(function (card, i) {
          var dist = Math.abs((card.offsetLeft + card.offsetWidth / 2) - center);
          if (dist < closestDist) { closestDist = dist; closest = i; }
        });
        dots.forEach(function (dot, i) { dot.classList.toggle("is-active", i === closest); });
      }

      track.addEventListener("scroll", function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateActive);
      }, { passive: true });
      updateActive();
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
     FAB tooltips (FAQ + WhatsApp) — sección 3a
     Tooltip text shows only after IDLE_DELAY of no scroll;
     hides immediately on scroll. One scroll listener drives all items.
     ------------------------------------------------------------- */
  function initFabTooltips() {
    var stack = $("[data-fab-stack]");
    if (!stack) return;
    var items = $$("[data-fab-item]", stack);
    if (!items.length) return;
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
     CTA bar — sección 2. Hidden until Hero fully leaves viewport.
     ------------------------------------------------------------- */
  function initCtaBarVisibility() {
    var bar = $("[data-cta-bar]");
    var hero = $("#top");
    if (!bar) return;
    if (!hero || !("IntersectionObserver" in window)) {
      // Caso límite: sin IntersectionObserver, mostrar siempre visible
      bar.classList.add("is-visible");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        bar.classList.toggle("is-visible", !entry.isIntersecting);
      });
    }, { threshold: 0 });
    io.observe(hero);
  }

  function initCtaBarHeight() {
    var bar = $("[data-cta-bar]");
    if (!bar) return;
    var set = function () {
      var h = bar.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--cta-bar-h", h + "px");
    };
    set();
    window.addEventListener("resize", debounce(set, 120));
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
    safe(initReveals, "initReveals");
    safe(initTransformShowcase, "initTransformShowcase");
    safe(initPersonalizacion, "initPersonalizacion");
    safe(initMarquee, "initMarquee");
    safe(initCarousels, "initCarousels");
    safe(initTilt, "initTilt");
    safe(initMockupTilt, "initMockupTilt");
    safe(initAccordion, "initAccordion");
    safe(initFabTooltips, "initFabTooltips");
    safe(initCtaBarVisibility, "initCtaBarVisibility");
    safe(initCtaBarHeight, "initCtaBarHeight");
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
