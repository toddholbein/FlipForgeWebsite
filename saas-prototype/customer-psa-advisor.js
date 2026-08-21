(() => {
  "use strict";

  const CONTRACT_VERSION = "1.0";
  const MAX_RESPONSE_CHARACTERS = 1_000_000;
  const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  const PRODUCTION_HOST = /^(?:www\.)?goflipforge\.com$/i;
  const PREVIEW_HOST = /^(?:deploy-preview-\d+--goflipforge\.netlify\.app|localhost|127\.0\.0\.1)$/i;
  const APP_PATH = /^\/(?:app|saas-prototype)(?:\/|$)/i;
  const HEALTH_PATH = "/api/v1/health";
  const OPPORTUNITIES_PATH = "/api/v1/opportunities";

  const state = {
    main: null,
    health: null,
    opportunities: [],
    selectedId: "",
    psa: null,
    loading: false,
    error: null
  };

  function productionHost() {
    return PRODUCTION_HOST.test(String(window.location.hostname || ""));
  }

  function eligibleHost() {
    const host = String(window.location.hostname || "");
    const pathname = String(window.location.pathname || "");
    if (PRODUCTION_HOST.test(host)) return APP_PATH.test(pathname);
    return PREVIEW_HOST.test(host) && (!pathname || APP_PATH.test(pathname));
  }

  function routeActive() {
    return String(window.location.hash || "#/dashboard")
      .replace(/^#\/?/, "")
      .split(/[/?]/)[0] === "psa-advisor";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function correlationId() {
    return window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `psa-advisor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function allowedPath(path) {
    const value = String(path || "");
    if (value === HEALTH_PATH || value === OPPORTUNITIES_PATH) return value;
    const match = value.match(/^\/api\/v1\/psa-advisor\/([^/?#]+)$/);
    if (!match) throw new Error("The requested PSA guidance path is not allowlisted.");
    let decoded = "";
    try { decoded = decodeURIComponent(match[1]); }
    catch (_) { throw new Error("The saved-card identifier is invalid."); }
    if (!SAFE_ID.test(decoded)) throw new Error("The saved-card identifier is invalid.");
    return value;
  }

  function validEnvelope(payload, expectedCorrelationId) {
    const meta = payload?.meta;
    return Boolean(meta)
      && meta.contractVersion === CONTRACT_VERSION
      && typeof meta.engineVersion === "string"
      && meta.engineVersion.length > 0
      && meta.authority === "Smart Opportunity"
      && meta.gradingAuthority === "Existing PSA intelligence"
      && meta.correlationId === expectedCorrelationId
      && Object.prototype.hasOwnProperty.call(payload, "data");
  }

  function validHealth(payload, expectedCorrelationId) {
    return Boolean(payload?.meta && payload?.data)
      && payload.meta.contractVersion === CONTRACT_VERSION
      && payload.meta.correlationId === expectedCorrelationId;
  }

  async function parseResponse(response) {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARACTERS) {
      throw Object.assign(new Error("The PSA guidance response exceeded the browser safety limit."), {
        code: "PSA_RESPONSE_TOO_LARGE"
      });
    }
    try { return text ? JSON.parse(text) : {}; }
    catch (_) {
      throw Object.assign(new Error("The PSA guidance gateway returned invalid JSON."), {
        code: "PSA_INVALID_JSON"
      });
    }
  }

  async function request(path) {
    const safePath = allowedPath(path);
    const requestCorrelationId = correlationId();
    const response = await fetch(safePath, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "X-Correlation-Id": requestCorrelationId
      }
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const upstream = payload?.error || {};
      throw Object.assign(new Error(upstream.message || `PSA guidance request failed with status ${response.status}.`), {
        code: upstream.code || "PSA_REQUEST_FAILED",
        status: response.status,
        correlationId: upstream.correlationId || requestCorrelationId
      });
    }
    const valid = safePath === HEALTH_PATH
      ? validHealth(payload, requestCorrelationId)
      : validEnvelope(payload, requestCorrelationId);
    if (!valid) {
      throw Object.assign(new Error("The PSA guidance response failed the FlipForge authority contract."), {
        code: "PSA_CONTRACT_INVALID"
      });
    }
    return payload;
  }

  function errorPanel(error) {
    if (!error) return "";
    const returnPath = state.selectedId
      ? `/app/#/psa-advisor/${encodeURIComponent(state.selectedId)}`
      : "/app/#/psa-advisor";
    const signIn = error.status === 401
      ? `<div class="customer-intelligence-actions"><a class="button button-primary" href="${productionHost() ? `/production-auth.html?return=${encodeURIComponent(returnPath)}` : "/staging-auth.html?returnTo=%2Fsaas-prototype%2F%23%2Fpsa-advisor"}">Sign in securely</a></div>`
      : "";
    return `<section class="panel staging-error" role="alert"><div class="panel-body"><strong>${escapeHtml(error.code || "PSA_GUIDANCE_UNAVAILABLE")}</strong><p>${escapeHtml(error.message)}</p><small>No mock PSA score, population value, grade prediction, or browser-generated recommendation was substituted.</small>${signIn}</div></section>`;
  }

  function optionMarkup() {
    return state.opportunities.map(item => {
      const id = String(item?.id || "");
      if (!SAFE_ID.test(id)) return "";
      const label = item?.title || item?.cardIdentity || id;
      return `<option value="${escapeHtml(id)}" ${id === state.selectedId ? "selected" : ""}>${escapeHtml(label)}</option>`;
    }).join("");
  }

  function badge(label, tone = "neutral") {
    return `<span class="staging-status staging-status-${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
  }

  function guidanceMarkup() {
    const envelope = state.psa;
    const psa = envelope?.data;
    if (!psa) return "";
    const snapshot = psa.savedPsaSnapshot || {};
    const population = psa.populationContext || {};
    const available = psa.guidanceStatus === "SAVED_GUIDANCE_AVAILABLE";
    const scoreReturned = snapshot.latestPsaScore !== null && snapshot.latestPsaScore !== undefined;
    const limitations = Array.isArray(envelope?.meta?.limitations) ? envelope.meta.limitations : [];

    return `<section class="panel"><header class="panel-header"><div><h2>${escapeHtml(psa.cardIdentity || "Saved PSA guidance")}</h2><p>Tenant-owned saved grading context from FlipForge's existing PSA intelligence authority.</p></div>${badge(available ? "Saved guidance available" : "Insufficient saved context", available ? "ok" : "warn")}</header><div class="panel-body"><div class="staging-key-grid"><div><span>Guidance status</span><strong>${escapeHtml(psa.guidanceStatus || "Unavailable")}</strong></div><div><span>PSA intelligence score</span><strong>${scoreReturned ? `${safeNumber(snapshot.latestPsaScore)}/100` : "Unavailable"}</strong></div><div><span>PSA impact</span><strong>${escapeHtml(snapshot.latestPsaImpact || "Unavailable")}</strong></div><div><span>Readiness</span><strong>${escapeHtml(snapshot.readinessStatus || "Unavailable")}</strong></div><div><span>PSA 10 population</span><strong>${population.available === true ? safeNumber(population.psa10Population) : "Unavailable"}</strong></div><div><span>PSA 9 population</span><strong>${population.available === true ? safeNumber(population.psa9Population) : "Unavailable"}</strong></div><div><span>Manual verification</span><strong>${snapshot.manualVerificationRequired === true ? "Required" : "Not required by saved snapshot"}</strong></div><div><span>Fresh comp evidence</span><strong>${snapshot.freshCompEvidenceRequired === true ? "Required" : "Not required by saved snapshot"}</strong></div><div><span>Additional population snapshot</span><strong>${snapshot.additionalSnapshotRequired === true ? "Required" : "Not required by saved snapshot"}</strong></div><div><span>Recalculated in browser</span><strong>${psa.recalculated === false ? "No" : "Invalid response"}</strong></div></div>${snapshot.boundaryMessage ? `<div class="boundary-note"><strong>PSA boundary:</strong> ${escapeHtml(snapshot.boundaryMessage)}</div>` : ""}${psa.authorityConflict ? `<div class="boundary-note"><strong>Authority conflict:</strong> ${escapeHtml(psa.authorityConflict)}</div>` : ""}<div class="customer-intelligence-actions"><a class="button button-secondary" href="#/opportunities/${encodeURIComponent(psa.opportunityId || state.selectedId)}">Open Card Intelligence</a><a class="button button-secondary" href="#/evidence/${encodeURIComponent(psa.opportunityId || state.selectedId)}">Review evidence</a></div>${limitations.length ? `<details><summary>Known limitations</summary><ul>${limitations.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}</div></section>`;
  }

  function pageMarkup() {
    const configured = state.health?.data?.status === "configured";
    const hasSavedCards = state.opportunities.length > 0;
    return `<div class="page staging-page customer-intelligence-page"><header class="page-heading"><div><span class="eyebrow">Existing PSA intelligence</span><h1>PSA Advisor</h1><p>Review saved PSA guidance, population context, and verification requirements for a tenant-owned card without predicting a grade or creating a new recommendation.</p></div><div class="page-actions"><button class="button button-secondary" type="button" data-psa-refresh>Refresh</button></div></header><div class="boundary-note"><strong>Authority boundary:</strong> This page reads saved PSA intelligence through the authenticated tenant-scoped gateway. It does not recalculate PSA scores in the browser, predict a grade, accept evidence, or authorize a transaction.</div>${state.loading ? `<div class="staging-loading" role="status">Loading saved PSA guidance…</div>` : ""}${errorPanel(state.error)}${configured && !state.loading && hasSavedCards ? `<section class="panel"><header class="panel-header"><div><h2>Choose a saved card</h2><p>PSA guidance is only shown for records already owned by this tenant.</p></div></header><div class="panel-body"><div class="field"><label for="psa-advisor-card">Saved card</label><select id="psa-advisor-card">${optionMarkup()}</select></div></div></section>${guidanceMarkup()}` : ""}${configured && !state.loading && !state.error && !hasSavedCards ? `<section class="panel"><div class="panel-body staging-empty"><strong>No saved cards yet.</strong><p>Evaluate a card first. FlipForge will not fabricate PSA guidance without a tenant-owned saved record.</p><a class="button button-primary" href="#/evaluate">Evaluate a card</a></div></section>` : ""}${!configured && state.health && !state.loading ? `<section class="panel"><div class="panel-body staging-empty"><strong>PSA Advisor is safely offline.</strong><p>The customer gateway is disabled, so no tenant request was attempted and no mock PSA data was substituted.</p></div></section>` : ""}</div>`;
  }

  function renderCurrent() {
    if (!state.main || !routeActive()) return;
    state.main.innerHTML = pageMarkup();
    const select = state.main.querySelector("#psa-advisor-card");
    if (select) {
      select.addEventListener("change", () => {
        const id = String(select.value || "");
        if (!SAFE_ID.test(id)) return;
        window.location.hash = `#/psa-advisor/${encodeURIComponent(id)}`;
      });
    }
    state.main.querySelectorAll?.("[data-psa-refresh]").forEach(button => button.addEventListener("click", () => load(state.selectedId)));
  }

  async function load(preferredId = "") {
    state.loading = true;
    state.health = null;
    state.opportunities = [];
    state.psa = null;
    state.error = null;
    if (SAFE_ID.test(String(preferredId || ""))) state.selectedId = String(preferredId);
    renderCurrent();
    try {
      state.health = await request(HEALTH_PATH);
      if (state.health?.data?.status !== "configured") return;
      const opportunities = await request(OPPORTUNITIES_PATH);
      const items = Array.isArray(opportunities?.data?.items) ? opportunities.data.items : [];
      state.opportunities = items.filter(item => SAFE_ID.test(String(item?.id || "")));
      if (!state.opportunities.length) return;
      const ids = state.opportunities.map(item => String(item.id));
      if (!ids.includes(state.selectedId)) state.selectedId = ids[0];
      state.psa = await request(`/api/v1/psa-advisor/${encodeURIComponent(state.selectedId)}`);
      const data = state.psa?.data;
      if (!data || data.kind !== "psa-advisor" || String(data.opportunityId || "") !== state.selectedId || data.recalculated !== false) {
        throw Object.assign(new Error("Saved PSA guidance did not match the selected tenant-owned card."), {
          code: "PSA_CONTRACT_INVALID"
        });
      }
    } catch (error) {
      state.error = error;
      state.psa = null;
    } finally {
      state.loading = false;
      renderCurrent();
    }
  }

  function render(main, id = "") {
    if (!eligibleHost() || !main) return false;
    state.main = main;
    load(String(id || ""));
    return true;
  }

  window.FlipForgeCustomerPsaAdvisor = Object.freeze({
    isEligible: eligibleHost,
    render
  });
})();
