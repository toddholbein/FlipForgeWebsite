(() => {
  "use strict";

  const CONTRACT_VERSION = "1.0";
  const DISCOVER_PATH = "/api/v1/discover";
  const EVALUATION_PATH = "/api/v1/evaluations";
  const MAX_RESPONSE_CHARACTERS = 1_000_000;
  const MAX_COST_CENTS = 10_000_000_000;
  const SAFE_EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:|\-]{0,199}$/;
  const SAFE_OPPORTUNITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
  const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;
  const PRODUCTION_HOST = /^(?:www\.)?goflipforge\.com$/i;
  const PREVIEW_HOST = /^(?:deploy-preview-\d+--goflipforge\.netlify\.app|localhost|127\.0\.0\.1)$/i;
  const APP_PATH = /^\/(?:app|saas-prototype)(?:\/|$)/i;
  const MARKETPLACES = new Set(["EBAY", "COMC", "MYSLABS", "GOLDIN", "HERITAGE", "FANATICS_COLLECT", "DEALER", "CARD_SHOW", "FACEBOOK_GROUP", "OTHER"]);
  const DECISIONS = new Set(["BUY", "WATCH", "VERIFY", "PASS"]);

  const state = {
    main: null,
    health: null,
    data: null,
    loading: false,
    evaluatingIndex: -1,
    error: null,
    notice: "",
    evaluationKeys: new Map(),
    lastSearch: null,
    draft: { exactCardQuery: "", targetMaxBuy: "", limit: "25" }
  };

  function eligibleHost() {
    const host = String(window.location.hostname || "");
    return (PRODUCTION_HOST.test(host) || PREVIEW_HOST.test(host))
      && APP_PATH.test(String(window.location.pathname || ""));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function correlationId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `discover-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function newIdempotencyKey() {
    const suffix = window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const value = `discover-eval-${suffix}`;
    if (!SAFE_REQUEST_ID.test(value)) throw makeError("IDEMPOTENCY_KEY_INVALID", "A safe evaluation request ID could not be generated.", 400);
    return value;
  }

  function makeError(code, message, status = 0) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
  }

  function moneyFromCents(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
      .format((Number(value) || 0) / 100);
  }

  function targetToCents(value) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
      throw makeError("DISCOVER_TARGET_INVALID", "Target max buy must be a non-negative dollar amount with no more than two decimals.", 400);
    }
    const [whole, fraction = ""] = text.split(".");
    const cents = (BigInt(whole) * 100n) + BigInt((fraction + "00").slice(0, 2));
    if (cents > BigInt(MAX_COST_CENTS)) throw makeError("DISCOVER_TARGET_INVALID", "Target max buy is outside the allowed range.", 400);
    return Number(cents);
  }

  function validHttpUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      return (parsed.protocol === "https:" || parsed.protocol === "http:") && Boolean(parsed.hostname);
    } catch (_) {
      return false;
    }
  }

  async function parseResponse(response) {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) throw makeError("DISCOVER_RESPONSE_TOO_LARGE", "The FlipForge response exceeded the browser safety limit.");
    try {
      return text ? JSON.parse(text) : {};
    } catch (_) {
      throw makeError("DISCOVER_INVALID_JSON", "The FlipForge gateway returned invalid JSON.");
    }
  }

  function validMeta(payload, expectedCorrelationId) {
    const meta = payload?.meta;
    return Boolean(meta)
      && meta.contractVersion === CONTRACT_VERSION
      && typeof meta.engineVersion === "string"
      && meta.engineVersion.length > 0
      && meta.authority === "Smart Opportunity"
      && meta.gradingAuthority === "Existing PSA intelligence"
      && meta.correlationId === expectedCorrelationId;
  }

  function validateDiscover(payload, expectedCorrelationId) {
    if (!validMeta(payload, expectedCorrelationId)) return false;
    const data = payload.data;
    const isolation = data?.tenantIsolation;
    if (!data || data.kind !== "discover" || data.readOnly !== true || !Array.isArray(data.items)) return false;
    if (data.discoveryPersisted !== false || data.evaluationRequiredToSave !== true) return false;
    if (data.activeListingsAreCompletedSaleEvidence !== false || data.transactionAuthority !== false) return false;
    if (data.tenantOwnedPersistenceCreated !== false || data.tenantOwnershipCreatedOnlyByEvaluation !== true) return false;
    if (!isolation || isolation.enforced !== true || isolation.defaultAccess !== "DENY") return false;
    const provider = data.provider;
    if (!provider || provider.providerCredentialsExposed !== false || provider.customerCanConfigureProvider !== false || Object.prototype.hasOwnProperty.call(provider, "action")) return false;
    return data.items.every(item => item
      && item.activeListingOnly === true
      && item.completedSaleEvidence === false
      && item.transactionAuthority === false
      && !Object.prototype.hasOwnProperty.call(item, "recommendation"));
  }

  function validateEvaluation(payload, expectedCorrelationId, expectedRequestId) {
    if (!validMeta(payload, expectedCorrelationId)) return false;
    const data = payload.data;
    const decision = data?.decision;
    const isolation = data?.tenantIsolation;
    return Boolean(data && decision && isolation)
      && data.kind === "evaluation"
      && data.requestId === expectedRequestId
      && SAFE_OPPORTUNITY_ID.test(String(data.opportunityId || ""))
      && data.persistedToSqlite === true
      && data.tenantOwned === true
      && data.requestCanVerifyEvidence === false
      && data.requestCanVerifyIdentity === false
      && data.evidenceAcceptedByRequest === false
      && data.psaRecalculated === false
      && data.transactionAuthorized === false
      && data.providerCredentialsExposed === false
      && DECISIONS.has(String(decision.recommendation || "").toUpperCase())
      && isolation.enforced === true
      && isolation.idempotencyScope === "TENANT"
      && isolation.opportunityOwnership === "GRANTED_ON_COMPLETION"
      && isolation.defaultAccess === "DENY";
  }

  async function request(path, { method = "GET", body = null, idempotencyKey = "" } = {}) {
    const requestCorrelationId = correlationId();
    const headers = { Accept: "application/json", "X-Correlation-Id": requestCorrelationId };
    if (body !== null) headers["Content-Type"] = "application/json; charset=utf-8";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const response = await fetch(path, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error"
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const upstream = payload?.error || {};
      throw makeError(upstream.code || "DISCOVER_REQUEST_FAILED", upstream.message || `FlipForge request failed with status ${response.status}.`, response.status);
    }
    return { payload, correlationId: requestCorrelationId };
  }

  function hasExplicitCardNumber(query) {
    const value = String(query || "");
    return /#\s*[A-Za-z0-9][A-Za-z0-9.-]*/.test(value)
      || /\bNO\.?\s*[A-Za-z0-9][A-Za-z0-9.-]*\b/i.test(value)
      || /\b(?:[A-Za-z]{1,6}[-.]?)?\d{1,5}[A-Za-z]?\s+(?:PSA|BGS|SGC|CGC|CSG|TAG|BCCG)\b/i.test(value);
  }

  function readSearch(form) {
    const values = new FormData(form);
    const exactCardQuery = String(values.get("exactCardQuery") || "").trim().replace(/\s+/g, " ");
    if (!exactCardQuery || exactCardQuery.length > 500) throw makeError("DISCOVER_QUERY_INVALID", "Enter an exact card identity of 500 characters or fewer.", 400);
    if (!hasExplicitCardNumber(exactCardQuery)) {
      throw makeError("DISCOVER_CARD_NUMBER_REQUIRED", "For private-beta safety, include the card number (for example, #150) so FlipForge can distinguish the base card from inserts and parallels.", 400);
    }
    const limit = Number.parseInt(String(values.get("limit") || "25"), 10);
    if (![10, 25, 50].includes(limit)) throw makeError("DISCOVER_LIMIT_INVALID", "Result limit must be 10, 25, or 50.", 400);
    const targetMaxBuy = String(values.get("targetMaxBuy") || "").trim();
    return { exactCardQuery, targetMaxBuy, limit, targetMaxBuyCents: targetToCents(targetMaxBuy) };
  }

  function safeEvaluationRequest(item) {
    if (!item || item.evaluationEligible !== true || !item.evaluationRequest || typeof item.evaluationRequest !== "object") {
      throw makeError("DISCOVER_EVALUATION_NOT_ELIGIBLE", "This active listing does not have the minimum verified fields required for authoritative evaluation.", 400);
    }
    const source = item.evaluationRequest;
    const externalListingId = String(source.externalListingId || "").trim();
    const marketplace = String(source.marketplace || "").trim().toUpperCase();
    const cardIdentity = String(source.cardIdentity || "").trim().replace(/\s+/g, " ");
    const listingUrl = String(source.listingUrl || "").trim();
    const seller = String(source.seller || "").trim().slice(0, 300);
    const listingFormat = String(source.listingFormat || "").trim().slice(0, 100);
    if (!SAFE_EXTERNAL_ID.test(externalListingId)) throw makeError("DISCOVER_EVALUATION_INVALID", "The listing ID is not safe for evaluation.", 400);
    if (!MARKETPLACES.has(marketplace)) throw makeError("DISCOVER_EVALUATION_INVALID", "The marketplace is not supported for evaluation.", 400);
    if (!cardIdentity || cardIdentity.length > 500) throw makeError("DISCOVER_EVALUATION_INVALID", "The card identity is not valid for evaluation.", 400);
    if (!validHttpUrl(listingUrl) || listingUrl.length > 2048) throw makeError("DISCOVER_EVALUATION_INVALID", "The listing URL is not valid for evaluation.", 400);
    const cents = name => {
      const value = Number(source[name]);
      if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COST_CENTS) throw makeError("DISCOVER_EVALUATION_INVALID", `${name} is invalid.`, 400);
      return value;
    };
    const itemPriceCents = cents("itemPriceCents");
    if (itemPriceCents <= 0) throw makeError("DISCOVER_EVALUATION_INVALID", "Item price must be greater than zero.", 400);
    return {
      externalListingId,
      marketplace,
      cardIdentity,
      listingUrl,
      seller,
      itemPriceCents,
      shippingCents: cents("shippingCents"),
      buyerPremiumCents: cents("buyerPremiumCents"),
      taxCents: cents("taxCents"),
      listingFormat
    };
  }

  function idempotencyKeyFor(payload) {
    const fingerprint = JSON.stringify(payload);
    let requestId = state.evaluationKeys.get(fingerprint);
    if (!requestId) {
      requestId = newIdempotencyKey();
      state.evaluationKeys.set(fingerprint, requestId);
    }
    return requestId;
  }

  async function loadHealth() {
    const result = await request("/api/v1/health");
    const meta = result.payload?.meta;
    const data = result.payload?.data;
    if (!meta || meta.contractVersion !== CONTRACT_VERSION || meta.correlationId !== result.correlationId || !data) {
      throw makeError("DISCOVER_HEALTH_INVALID", "The gateway health response failed its contract.");
    }
    state.health = data;
  }

  async function runSearch(draft) {
    state.error = null;
    state.notice = "";
    state.data = null;
    state.draft = { exactCardQuery: draft.exactCardQuery, targetMaxBuy: draft.targetMaxBuy, limit: String(draft.limit) };
    state.loading = true;
    renderCurrent();
    try {
      const result = await request(DISCOVER_PATH, {
        method: "POST",
        body: { exactCardQuery: draft.exactCardQuery, limit: draft.limit, targetMaxBuyCents: draft.targetMaxBuyCents }
      });
      if (!validateDiscover(result.payload, result.correlationId)) throw makeError("DISCOVER_CONTRACT_INVALID", "The provider-backed Discover response failed the FlipForge authority, evidence, or tenant contract.");
      state.data = result.payload.data;
      state.lastSearch = { exactCardQuery: draft.exactCardQuery, targetMaxBuy: draft.targetMaxBuy, limit: draft.limit, targetMaxBuyCents: draft.targetMaxBuyCents };
      state.notice = state.data.candidateCount
        ? `${state.data.candidateCount} active candidate${state.data.candidateCount === 1 ? "" : "s"} returned from currently connected sources.`
        : state.data.provider?.available === false
          ? "The authorized active-listing provider is not connected for this runtime. No sample results were substituted."
          : "No active candidates matched this exact-card search.";
      if (state.data.candidateCount > 0) {
        state.draft = { exactCardQuery: "", targetMaxBuy: "", limit: String(draft.limit) };
      }
    } catch (error) {
      state.error = error;
    } finally {
      state.loading = false;
      renderCurrent();
    }
  }

  async function search(form) {
    let draft;
    try {
      draft = readSearch(form);
    } catch (error) {
      state.error = error;
      renderCurrent();
      return;
    }
    await runSearch(draft);
  }

  async function refreshResults() {
    if (!state.lastSearch || state.loading || state.evaluatingIndex >= 0) return;
    await runSearch({ ...state.lastSearch });
  }

  function clearDiscovery() {
    if (state.loading || state.evaluatingIndex >= 0) return;
    const preservedLimit = String(state.draft.limit || state.lastSearch?.limit || "25");
    state.data = null;
    state.error = null;
    state.notice = "";
    state.lastSearch = null;
    state.evaluationKeys.clear();
    state.draft = { exactCardQuery: "", targetMaxBuy: "", limit: preservedLimit };
    renderCurrent();
    state.main?.querySelector?.('input[name="exactCardQuery"]')?.focus?.();
  }

  async function evaluate(index) {
    if (!state.data || !Array.isArray(state.data.items)) return;
    const item = state.data.items[index];
    state.error = null;
    state.notice = "";
    state.evaluatingIndex = index;
    renderCurrent();
    try {
      const payload = safeEvaluationRequest(item);
      const requestId = idempotencyKeyFor(payload);
      const result = await request(EVALUATION_PATH, { method: "POST", body: payload, idempotencyKey: requestId });
      if (!validateEvaluation(result.payload, result.correlationId, requestId)) throw makeError("DISCOVER_EVALUATION_CONTRACT_INVALID", "The authoritative evaluation response failed the tenant-owned Smart Opportunity contract.");
      window.location.hash = `#/opportunities/${encodeURIComponent(result.payload.data.opportunityId)}`;
    } catch (error) {
      state.error = error;
      state.evaluatingIndex = -1;
      renderCurrent();
    }
  }

  function errorPanel() {
    if (!state.error) return "";
    const guidance = state.error.status === 401
      ? "Sign in with an invited private-beta account."
      : state.error.status === 403
        ? "The signed-in account needs an active FlipForge tenant membership."
        : "No mock listing, browser recommendation, or partial evaluation was substituted.";
    return `<section class="panel staging-error" role="alert"><div class="panel-body"><strong>${escapeHtml(state.error.code || "DISCOVER_UNAVAILABLE")}</strong><p>${escapeHtml(state.error.message)}</p><small>${escapeHtml(guidance)}</small></div></section>`;
  }

  function searchPanel() {
    const busy = state.loading || state.evaluatingIndex >= 0;
    const refreshDisabled = busy || !state.lastSearch;
    return `<section class="panel customer-discovery-search"><header class="panel-header"><div><h2>Search connected active listings</h2><p>Use an exact card identity: year, set, player, card number, parallel/base, and grade when applicable. Card number is required during private beta.</p></div></header><div class="panel-body"><form data-customer-discovery-form class="customer-discovery-form"><label><span>Exact card identity</span><input name="exactCardQuery" type="search" maxlength="500" required value="${escapeHtml(state.draft.exactCardQuery)}" placeholder="2018 Topps Chrome Shohei Ohtani #150 PSA 10" autocomplete="off"></label><label><span>Target max buy</span><input name="targetMaxBuy" type="text" inputmode="decimal" value="${escapeHtml(state.draft.targetMaxBuy)}" placeholder="Optional, e.g. 525.00" autocomplete="off"></label><label><span>Results</span><select name="limit">${[10,25,50].map(value => `<option value="${value}"${String(value) === state.draft.limit ? " selected" : ""}>${value}</option>`).join("")}</select></label><button class="button button-primary" type="submit" ${busy ? "disabled" : ""}>${state.loading ? "Searching…" : "Search connected sources"}</button><button class="button button-secondary" type="button" data-discovery-refresh ${refreshDisabled ? "disabled" : ""}>${state.loading && state.lastSearch ? "Refreshing…" : "Refresh results"}</button><button class="button button-secondary" type="button" data-discovery-clear ${busy ? "disabled" : ""}>Clear / New search</button></form></div></section>`;
  }

  function providerPanel() {
    if (!state.data) return "";
    const provider = state.data.provider || {};
    const tone = provider.available ? "ok" : "warn";
    return `<section class="panel"><header class="panel-header"><div><h2>Connected source status</h2><p>${escapeHtml(provider.status || "Provider status unavailable.")}</p></div><span class="staging-status staging-status-${tone}">${provider.available ? "Connected" : "Unavailable"}</span></header><div class="panel-body customer-discovery-provider"><span><strong>${escapeHtml(provider.name || "Authorized source")}</strong><small>Automated active-listing connector · customer configuration disabled</small></span><span><strong>${escapeHtml(state.data.candidateCount || 0)}</strong><small>Active candidates</small></span><span><strong>${escapeHtml(state.data.evidenceSupportedCount || 0)}</strong><small>With trusted exact sold context</small></span></div></section>`;
  }

  function candidateCard(item, index) {
    const evidence = item.evidence || {};
    const label = item.discoveryLabel === "BEST_CONNECTED_CANDIDATE"
      ? "Best connected candidate"
      : String(item.discoveryLabel || "Connected candidate").replaceAll("_", " ");
    const evaluateDisabled = item.evaluationEligible !== true || state.evaluatingIndex >= 0;
    return `<article class="panel customer-discovery-candidate"><header class="panel-header"><div><span class="eyebrow">Rank ${escapeHtml(item.rank || index + 1)} · ${escapeHtml(item.providerDisplayName || item.marketplace || "Authorized source")}</span><h2>${escapeHtml(item.title || item.cardIdentityQuery || "Active listing")}</h2><p>${escapeHtml(label)}</p></div><span class="customer-discovery-score"><strong>${escapeHtml(item.discoveryScore ?? 0)}</strong><small>Discovery score</small></span></header><div class="panel-body"><div class="customer-discovery-metrics"><div><span>All-in ask</span><strong>${moneyFromCents(item.allInAskCents)}</strong><small>${item.allInCostComplete ? "Complete returned cost" : "Cost review required"}</small></div><div><span>Trusted exact sold context</span><strong>${escapeHtml(evidence.trustedExactCompletedSaleCount ?? 0)} sales</strong><small>${evidence.supported ? moneyFromCents(evidence.trustedEvidenceValueCents) + " median context" : "Evidence required"}</small></div><div><span>Confidence context</span><strong>${escapeHtml(evidence.calibratedConfidence ?? 0)}/100</strong><small>Risk ${escapeHtml(evidence.risk ?? 0)}/100</small></div><div><span>Listing state</span><strong>${escapeHtml(String(item.listingAvailability || "UNKNOWN").replaceAll("_", " "))}</strong><small>${escapeHtml(String(item.listingFreshness || "UNKNOWN").replaceAll("_", " "))}</small></div></div><div class="customer-discovery-copy"><p><strong>Price position:</strong> ${escapeHtml(item.pricePosition || "Evidence required")}</p><p><strong>Next action:</strong> ${escapeHtml(item.nextAction || "Verify the listing before evaluation.")}</p></div><div class="customer-discovery-actions"><a class="button button-secondary" href="${escapeHtml(validHttpUrl(item.listingUrl) ? item.listingUrl : "#")}" target="_blank" rel="noopener noreferrer">Open listing</a><button class="button button-primary" type="button" data-discovery-evaluate="${index}" ${evaluateDisabled ? "disabled" : ""}>${state.evaluatingIndex === index ? "Evaluating…" : "Evaluate with Smart Opportunity"}</button></div><div class="boundary-note"><strong>Discovery only:</strong> This active listing is not a sold comp and this score is not BUY/WATCH/VERIFY/PASS. Evaluation is a separate explicit request.</div></div></article>`;
  }

  function resultsPanel() {
    if (!state.data) return "";
    const items = Array.isArray(state.data.items) ? state.data.items : [];
    if (!items.length) return `<section class="panel"><div class="panel-body staging-empty"><strong>No active candidate is available.</strong><p>${escapeHtml(state.data.coverageSummary || "No connected listing matched this search.")}</p></div></section>`;
    return `<section class="customer-discovery-results" aria-label="Active discovery candidates"><div class="customer-discovery-summary"><strong>${escapeHtml(state.data.coverageSummary || "Connected-source discovery results")}</strong><span>Best candidate means best across currently connected sources—not the entire market.</span></div>${items.map(candidateCard).join("")}</section>`;
  }

  function renderCurrent() {
    if (!state.main) return;
    if (state.health && state.health.status !== "configured") {
      state.main.innerHTML = `<div class="page customer-discovery-page"><header class="page-heading"><div><span class="eyebrow">Provider-backed market discovery</span><h1>Discover</h1><p>Find active listings across approved connected sources without treating asking prices as completed-sale evidence.</p></div></header><div class="boundary-note"><strong>Authority boundary:</strong> Smart Opportunity remains the sole BUY/WATCH/VERIFY/PASS authority. Discover does not save or recommend a listing.</div><section class="panel"><div class="panel-body staging-empty"><strong>Discover is safely offline.</strong><p>The private-beta API bridge is disabled, so no provider search was attempted and no sample results were substituted.</p></div></section></div>`;
      return;
    }
    state.main.innerHTML = `<div class="page customer-discovery-page"><header class="page-heading"><div><span class="eyebrow">Provider-backed market discovery</span><h1>Discover</h1><p>Search approved active-listing sources, compare all-in asks against existing trusted evidence context, then explicitly evaluate the listing you want FlipForge to judge.</p></div><div class="page-actions"><a class="button button-secondary" href="#/opportunities">Saved opportunities</a><a class="button button-secondary" href="#/evaluate">Manual evaluate</a></div></header><div class="boundary-note"><strong>Authority boundary:</strong> Discover ranks active candidates only. It does not create BUY/WATCH/VERIFY/PASS, accept evidence, persist a search, or authorize a transaction.</div>${errorPanel()}${state.notice ? `<div class="customer-discovery-notice" role="status">${escapeHtml(state.notice)}</div>` : ""}${searchPanel()}${providerPanel()}${resultsPanel()}</div>`;
    bindActions();
  }

  function bindActions() {
    const form = state.main?.querySelector?.("[data-customer-discovery-form]");
    form?.addEventListener("submit", event => {
      event.preventDefault();
      if (!state.loading && state.evaluatingIndex < 0) search(form);
    });
    state.main?.querySelector?.("[data-discovery-refresh]")?.addEventListener("click", () => {
      if (!state.loading && state.evaluatingIndex < 0) refreshResults();
    });
    state.main?.querySelector?.("[data-discovery-clear]")?.addEventListener("click", () => {
      if (!state.loading && state.evaluatingIndex < 0) clearDiscovery();
    });
    state.main?.querySelectorAll?.("[data-discovery-evaluate]").forEach(button => {
      button.addEventListener("click", () => {
        const index = Number.parseInt(button.dataset.discoveryEvaluate || "-1", 10);
        if (Number.isInteger(index) && index >= 0 && state.evaluatingIndex < 0) evaluate(index);
      });
    });
  }

  async function render(main) {
    state.main = main;
    state.error = null;
    state.notice = "";
    if (!eligibleHost()) return false;
    if (!state.health) {
      state.loading = true;
      renderCurrent();
      try {
        await loadHealth();
      } catch (error) {
        state.error = error;
      } finally {
        state.loading = false;
      }
    }
    renderCurrent();
    return true;
  }

  window.FlipForgeCustomerDiscovery = Object.freeze({ isEligible: eligibleHost, render });
})();
