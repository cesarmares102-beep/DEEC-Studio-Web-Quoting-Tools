/* ==========================================================================
   DEEC Studio — checkout.html page logic (vanilla JS, IIFE, no deps)

   Loaded only by checkout.html, after main.js — main.js still drives nav,
   menu, footer accordion, cookie consent, language toggle, and legal
   versioning on this page unchanged; nothing here touches or duplicates
   that. This file owns only the checkout form → acceptance → Whop
   embedded checkout → payment-result flow described in the checkout spec.

   Flow implemented (see functions/api/checkout/create.js and
   functions/api/checkout/status.js for the server half):

     1. Visitor fills Panel 1 fields and checks the Panel 3 checkbox.
     2. Clicks "Continuar al pago" — client-side validation only gates the
        button; the server re-validates everything independently.
     3. POST /api/checkout/create registers the acceptance in D1 and
        returns a Whop `plan` id + `metadata` (acceptance_id,
        checkout_reference) + a `return_url`.
     4. Whop's checkout-embed script is loaded (lazily, only now) and
        mounted with that config — see mountWhopCheckout() for the exact
        API, sourced from https://docs.whop.com/developer/guides/
        embed-checkout, not invented.
     5. Whop's own iframe handles card entry; this page never sees card
        data. `onComplete` fires client-side but is explicitly NOT trusted
        to mean "paid" (Whop's own docs warn a restored checkout can fire
        it again for the same result) — it only drives an optimistic
        "processing" message.
     6. Whop redirects the browser to `returnUrl` (this same page, with
        ?acceptance=...&payment=...&status=...). initReturnFlow() detects
        that and polls GET /api/checkout/status, which reflects only what
        the payment webhook (server-to-server, never the client) wrote to
        D1 — that's the one and only source of truth this page shows as
        "payment confirmed".
   ========================================================================== */
(function () {
  "use strict";

  var $ = function (sel, scope) { return (scope || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(sel)); };

  function safe(fn, name) {
    try { fn(); } catch (e) { if (window.console) console.warn("[checkout:" + name + "]", e); }
  }

  var t = function (key) {
    // Mirrors main.js's t(): same window.__I18N__ dictionary, same
    // "follow whatever <html lang> main.js already set" behavior — this
    // file never picks its own language, it just reads the one main.js's
    // initLangToggle()/applyLanguage() already settled on.
    var lang = document.documentElement.getAttribute("lang") || "es";
    var I18N = window.__I18N__ || { es: {}, en: {} };
    var dict = I18N[lang] || I18N.es || {};
    return dict[key] != null ? dict[key] : key;
  };

  var WHOP_CHECKOUT_SCRIPT_SRC = "https://cdn.whop.com/elements/amber/elements.js";
  var PRODUCT_ID = "quoting-tool";

  var els = {};
  var idempotencyKey = null;
  var submitting = false;

  function cacheEls() {
    els.form = $("[data-checkout-form]");
    els.result = $("[data-checkout-result]");
    els.resultTitle = $("[data-checkout-result-title]");
    els.resultBody = $("[data-checkout-result-body]");
    els.resultRetry = $("[data-checkout-result-retry]");
    els.name = $('[data-field="name"]');
    els.email = $('[data-field="email"]');
    els.phone = $('[data-field="phone"]');
    els.business = $('[data-field="business"]');
    els.country = $('[data-field="country"]');
    els.terms = $('[data-field="terms"]');
    els.stateMsg = $("[data-checkout-state-msg]");
    els.continueBtn = $("[data-checkout-continue]");
    els.continueLabel = $("[data-checkout-continue-label]");
    els.whopMount = $("[data-whop-mount]");
  }

  /* -------------------------------------------------------------
     Idempotency key — one per page load (spec section 15). A double
     click or a network retry before the button disables reuses this
     same value; only a fresh page load gets a new one, which is the
     correct boundary (a genuinely new visit is a new legitimate attempt,
     not a duplicate of the last one).
     ------------------------------------------------------------- */
  function makeIdempotencyKey() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // Fallback for older browsers without crypto.randomUUID — collision
    // odds are astronomically low for a single-session key like this.
    return "idem-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  /* -------------------------------------------------------------
     Validation — client-side only gates the button/UX; the server
     re-validates every one of these independently (see create.js) and
     is what actually decides whether an acceptance gets created.
     ------------------------------------------------------------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validate() {
    var errors = [];
    if (!els.name || !els.name.value.trim()) errors.push("incomplete");
    if (!els.email || !EMAIL_RE.test(els.email.value.trim())) errors.push("invalidEmail");
    if (!els.terms || !els.terms.checked) errors.push("termsRequired");
    return errors;
  }

  function setStateMsg(key) {
    if (!els.stateMsg) return;
    els.stateMsg.textContent = key ? t("checkout.state." + key) : "";
  }

  function setButtonState(state) {
    if (!els.continueBtn || !els.continueLabel) return;
    if (state === "idle") {
      els.continueBtn.disabled = false;
      els.continueBtn.hidden = false;
      els.continueLabel.textContent = t("checkout.cta.continue");
    } else if (state === "preparing") {
      els.continueBtn.disabled = true;
      els.continueLabel.textContent = t("checkout.cta.preparing");
    } else if (state === "whop-loading") {
      els.continueLabel.textContent = t("checkout.state.whopLoading");
    } else if (state === "hidden") {
      els.continueBtn.hidden = true;
    }
  }

  /* -------------------------------------------------------------
     Reads the CURRENT terms version from window.__LEGAL_DOCS__ (see
     lib/legal-versions.js, already loaded on this page) at submit time,
     rather than hardcoding the number a third time in this file. The
     server independently validates this against its own copy in
     functions/lib/current-terms-version.js — see that file's header
     comment for why the version has to live in two places at all (the
     browser/Worker runtime boundary).
     ------------------------------------------------------------- */
  function currentTermsVersion() {
    var docs = window.__LEGAL_DOCS__;
    var doc = docs && docs["terms-and-conditions"];
    return (doc && doc.currentVersion) || "";
  }

  function currentTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (err) {
      return "";
    }
  }

  /* -------------------------------------------------------------
     Whop Elements — lazy script load, called only once, only after the
     acceptance is registered (never preloaded, never on page load).
     ------------------------------------------------------------- */
  var whopScriptPromise = null;
  function loadWhopScript() {
    if (window.WhopElements) return Promise.resolve();
    if (whopScriptPromise) return whopScriptPromise;
    whopScriptPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = WHOP_CHECKOUT_SCRIPT_SRC;
      s.setAttribute("data-whop-elements", "");
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error("Whop Elements script failed to load")); };
      document.body.appendChild(s);
    });
    return whopScriptPromise;
  }

  /**
   * Mounts Whop's embedded checkout element.
   *
   * The first argument to the inner `.create(...)` is NOT the mount div's
   * id — it's a fixed element-type keyword, always the literal string
   * "checkout" — confirmed against docs.whop.com/developer/guides/
   * embed-checkout's own code sample, which uses `<div id="checkout">`
   * and `checkout.create("checkout").mount("#checkout")` (mount id and
   * type keyword happen to be the same string there, which is what made
   * this easy to misread the first time around). Passing our own mount
   * id ("whop-checkout-mount") as the type was a real, confirmed-live
   * bug: the iframe still loaded (at .../checkout/whop-checkout-mount/
   * instead of .../checkout/checkout/) but never received a valid
   * element to render, so it stayed stuck at opacity:0/height:0 forever.
   */
  function mountWhopCheckout(mountElId, config) {
    if (!window.WhopElements) throw new Error("WhopElements script not loaded");
    var api = window.WhopElements();
    var checkout = api.checkout.create({
      plan: config.plan,
      metadata: config.metadata,
      returnUrl: config.returnUrl,
      onComplete: function (completion) {
        // Per Whop's docs: never treat this as fulfillment/confirmation —
        // a checkout restored on a later page load fires it again for
        // the same result. It only drives the optimistic message below;
        // the real confirmation comes from initReturnFlow()'s server poll.
        if (completion && completion.result === "payment") {
          setStateMsg(null);
          if (els.stateMsg) els.stateMsg.textContent = t("checkout.cta.processing");
        }
      }
    });
    checkout.create("checkout").mount("#" + mountElId);
    return checkout;
  }

  /* -------------------------------------------------------------
     Submit — Estado 1→4 of the spec's checkout state machine.
     ------------------------------------------------------------- */
  function handleContinue() {
    if (submitting) return;

    var errors = validate();
    if (errors.length) {
      // Show the most specific problem first (terms, then email, then
      // "fill everything in") rather than stacking every message at once.
      if (errors.indexOf("termsRequired") !== -1) setStateMsg("termsRequired");
      else if (errors.indexOf("invalidEmail") !== -1) setStateMsg("invalidEmail");
      else setStateMsg("incomplete");
      return;
    }

    submitting = true;
    setStateMsg(null);
    setButtonState("preparing");

    var payload = {
      idempotency_key: idempotencyKey,
      customer_name: els.name.value.trim(),
      customer_email: els.email.value.trim(),
      customer_phone: els.phone ? els.phone.value.trim() : "",
      business_name: els.business ? els.business.value.trim() : "",
      country: els.country ? els.country.value.trim() : "",
      product_id: PRODUCT_ID,
      // Which Whop plan gets charged — Whop has a separate plan per
      // language for this product (see functions/lib/current-terms-
      // version.js), so this has to match whichever language the buyer
      // is actually looking at right now.
      lang: document.documentElement.getAttribute("lang") === "en" ? "en" : "es",
      terms_version: currentTermsVersion(),
      terms_accepted: !!(els.terms && els.terms.checked),
      timezone: currentTimezone()
    };

    fetch("/api/checkout/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          console.warn("[checkout] create failed:", result.data);
          setStateMsg("genericError");
          submitting = false;
          setButtonState("idle");
          return;
        }
        return loadWhopScript().then(function () {
          setButtonState("whop-loading");
          els.whopMount.hidden = false;
          mountWhopCheckout("whop-checkout-mount", {
            plan: result.data.plan,
            metadata: result.data.metadata,
            returnUrl: result.data.return_url
          });
          setButtonState("hidden");
        });
      })
      .catch(function (err) {
        if (window.console) console.warn("[checkout] network error:", err);
        setStateMsg("networkError");
        submitting = false;
        setButtonState("idle");
      });
  }

  /* -------------------------------------------------------------
     Return flow — after Whop redirects back to
     checkout.html?acceptance=acc_...&payment=pay_...&status=succeeded
     ------------------------------------------------------------- */
  function showResult(kind) {
    if (!els.form || !els.result) return;
    els.form.hidden = true;
    els.result.hidden = false;
    var titleKey, bodyKey, showRetry;
    if (kind === "paid") {
      titleKey = "checkout.result.paidTitle"; bodyKey = "checkout.result.paidBody"; showRetry = false;
    } else if (kind === "pending") {
      titleKey = "checkout.result.pendingTitle"; bodyKey = "checkout.result.pendingBody"; showRetry = false;
    } else {
      titleKey = "checkout.result.failedTitle"; bodyKey = "checkout.result.failedBody"; showRetry = true;
    }
    if (els.resultTitle) els.resultTitle.textContent = t(titleKey);
    if (els.resultBody) els.resultBody.textContent = t(bodyKey);
    if (els.resultRetry) els.resultRetry.hidden = !showRetry;
  }

  function pollStatus(acceptanceId) {
    var attempts = 0;
    var MAX_ATTEMPTS = 15; // ~30s at 2s apart — long enough for the webhook to land, short enough not to hang forever
    var INTERVAL_MS = 2000;

    function tick() {
      attempts++;
      fetch("/api/checkout/status?acceptance_id=" + encodeURIComponent(acceptanceId))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.status === "paid") {
            showResult("paid");
            return;
          }
          if (data && (data.status === "payment_failed" || data.status === "canceled")) {
            showResult("failed");
            return;
          }
          if (attempts >= MAX_ATTEMPTS) {
            // Still not confirmed after ~30s — don't claim success we
            // haven't verified. Leave it as "confirming" rather than
            // guessing; the webhook may just be slow, and a refresh will
            // pick up the real status once it lands.
            return;
          }
          setTimeout(tick, INTERVAL_MS);
        })
        .catch(function () {
          if (attempts < MAX_ATTEMPTS) setTimeout(tick, INTERVAL_MS);
        });
    }
    tick();
  }

  function initReturnFlow() {
    var params = new URLSearchParams(window.location.search);
    var acceptance = params.get("acceptance");
    var paymentStatus = params.get("status");
    if (!acceptance) return false; // normal first visit, not a return from Whop

    // "failed"/"canceled" from Whop's own redirect is safe to show
    // immediately — it isn't a claim of success that needs server
    // verification, only a claim of non-success, which carries no risk
    // of granting anything the visitor didn't earn.
    if (paymentStatus === "failed" || paymentStatus === "canceled") {
      showResult("failed");
      return true;
    }

    // Anything else ("succeeded", "processing", or missing) still goes
    // through the server poll — the URL alone never confirms "paid".
    showResult("pending");
    pollStatus(acceptance);
    return true;
  }

  function boot() {
    cacheEls();
    if (!els.form) return; // not on checkout.html

    idempotencyKey = makeIdempotencyKey();

    if (initReturnFlow()) return; // return-from-Whop state takes over the whole page

    if (els.continueBtn) els.continueBtn.addEventListener("click", handleContinue);

    // Clear the current error message as soon as the visitor starts
    // fixing whatever it was complaining about — don't make them
    // re-click to find out the message is gone.
    [els.name, els.email, els.terms].forEach(function (el) {
      if (!el) return;
      el.addEventListener("input", function () { setStateMsg(null); });
      el.addEventListener("change", function () { setStateMsg(null); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { safe(boot, "boot"); });
  } else {
    safe(boot, "boot");
  }
})();
