const crypto = require("crypto");

const CONTRACT_VERSION = "1.0";
const TRUSTED_TENANT_HEADER = "X-FlipForge-Tenant-Id";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_MAX_REQUEST_BYTES = 65_536;

const ROUTES = [
  { method: "GET", pattern: /^\/api\/v1\/health$/ },
  { method: "GET", pattern: /^\/api\/v1\/dashboard$/ },
  { method: "GET", pattern: /^\/api\/v1\/opportunities$/ },
  { method: "GET", pattern: /^\/api\/v1\/opportunities\/[A-Za-z0-9._:-]+$/ },
  { method: "GET", pattern: /^\/api\/v1\/compare$/ },
  { method: "GET", pattern: /^\/api\/v1\/psa-advisor\/[A-Za-z0-9._:-]+$/ },
  { method: "GET", pattern: /^\/api\/v1\/evidence\/[A-Za-z0-9._:-]+$/ },
  { method: "GET", pattern: /^\/api\/v1\/portfolio$/ },
  { method: "GET", pattern: /^\/api\/v1\/alerts$/ },
  { method: "GET", pattern: /^\/api\/v1\/account$/ },
  { method: "GET", pattern: /^\/api\/v1\/entitlements$/ },
  { method: "POST", pattern: /^\/api\/v1\/evaluations$/ }
];

function header(event, name) {
  const headers = event && event.headers ? event.headers : {};
  const target = String(name).toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === target);
  return key ? headers[key] : null;
}

function integerFromEnv(name, fallback, maximum) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function securityHeaders(event, correlationId) {
  const origin = header(event, "origin");
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Correlation-Id": correlationId,
    Vary: "Origin"
  };

  if (origin && originAllowed(event, origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

function jsonResponse(event, statusCode, body, correlationId, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...securityHeaders(event, correlationId),
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function errorEnvelope(code, message, correlationId, details = null) {
  return {
    error: {
      code,
      message,
      correlationId,
      ...(details ? { details } : {})
    }
  };
}

function originAllowed(event, origin) {
  try {
    const parsed = new URL(origin);
    const requestHost = header(event, "host");
    if (requestHost && parsed.protocol === "https:" && parsed.host === requestHost) {
      return true;
    }

    const configured = String(process.env.FLIPFORGE_API_ALLOWED_ORIGINS || "")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean);

    return configured.includes(parsed.origin);
  } catch (_) {
    return false;
  }
}

function normalizedApiPath(event) {
  const rawPath = String((event && event.path) || "");
  const marker = "/api/v1/";
  const index = rawPath.indexOf(marker);
  if (index >= 0) return rawPath.slice(index).replace(/\/+$/, "");
  if (rawPath.endsWith("/api/v1")) return "/api/v1";
  return rawPath.replace(/\/+$/, "");
}

function routeAllowed(method, path) {
  return ROUTES.some(route => route.method === method && route.pattern.test(path));
}

function bridgeEnabled() {
  return String(process.env.FLIPFORGE_API_BRIDGE_ENABLED || "").toLowerCase() === "true";
}

function upstreamConfigured() {
  return Boolean(
    process.env.FLIPFORGE_API_BASE_URL &&
      process.env.FLIPFORGE_API_SERVICE_TOKEN
  );
}

function previewBypassAllowed() {
  const context = String(process.env.CONTEXT || "").toLowerCase();
  const requested = String(process.env.FLIPFORGE_API_ALLOW_UNAUTHENTICATED_PREVIEW || "").toLowerCase() === "true";
  return requested && context && context !== "production";
}

function authenticatedUser(context) {
  return context && context.clientContext && context.clientContext.user
    ? context.clientContext.user
    : null;
}

function validTrustedTenantId(value) {
  const tenantId = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(tenantId) ? tenantId : null;
}

function authenticatedTenantId(user) {
  return validTrustedTenantId(user && user.sub);
}

function previewTenantId() {
  if (!previewBypassAllowed()) return null;
  return validTrustedTenantId(process.env.FLIPFORGE_API_PREVIEW_TENANT_ID);
}

function validIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._-]{8,100}$/.test(key) ? key : null;
}

function queryString(event) {
  if (event && typeof event.rawQuery === "string" && event.rawQuery) {
    return event.rawQuery;
  }

  const parameters = event && event.queryStringParameters ? event.queryStringParameters : {};
  return new URLSearchParams(
    Object.entries(parameters).filter(([, value]) => value !== undefined && value !== null)
  ).toString();
}

function validTenantIsolation(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const isolation = data.tenantIsolation;
  return Boolean(
    isolation &&
      typeof isolation === "object" &&
      !Array.isArray(isolation) &&
      isolation.enforced === true &&
      isolation.defaultAccess === "DENY" &&
      typeof isolation.tenantAuditKey === "string" &&
      /^[a-f0-9]{12}$/.test(isolation.tenantAuditKey)
  );
}

function validUpstreamEnvelope(payload, correlationId, method, path) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  if (!payload.meta || typeof payload.meta !== "object") return false;

  const meta = payload.meta;
  if (
    meta.contractVersion !== CONTRACT_VERSION ||
    typeof meta.engineVersion !== "string" ||
    meta.engineVersion.length === 0 ||
    meta.authority !== "Smart Opportunity" ||
    meta.gradingAuthority !== "Existing PSA intelligence" ||
    typeof meta.generatedAt !== "string" ||
    meta.generatedAt.length === 0 ||
    meta.correlationId !== correlationId ||
    !Object.prototype.hasOwnProperty.call(payload, "data") ||
    !validTenantIsolation(payload.data)
  ) {
    return false;
  }

  if (method === "POST" && path === "/api/v1/evaluations") {
    return Boolean(
      payload.data.tenantOwned === true &&
        payload.data.tenantIsolation.idempotencyScope === "TENANT" &&
        payload.data.tenantIsolation.opportunityOwnership === "GRANTED_ON_COMPLETION" &&
        payload.data.transactionAuthorized === false
    );
  }
  return true;
}

async function readLimitedJson(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers.get("content-length") || "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error("Upstream response exceeded the configured size limit.");
    error.code = "UPSTREAM_RESPONSE_TOO_LARGE";
    throw error;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    const error = new Error("Upstream response exceeded the configured size limit.");
    error.code = "UPSTREAM_RESPONSE_TOO_LARGE";
    throw error;
  }

  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  try {
    return JSON.parse(text);
  } catch (_) {
    const error = new Error("Upstream returned invalid JSON.");
    error.code = "UPSTREAM_INVALID_JSON";
    throw error;
  }
}

function healthPayload(correlationId) {
  return {
    meta: {
      contractVersion: CONTRACT_VERSION,
      correlationId,
      generatedAt: new Date().toISOString()
    },
    data: {
      service: "flipforge-saas-api-gateway",
      status: bridgeEnabled() && upstreamConfigured() ? "configured" : "disabled",
      bridgeEnabled: bridgeEnabled(),
      upstreamConfigured: upstreamConfigured(),
      authenticationRequired: true,
      trustedTenantContextForwardedServerSide: true,
      trustedTenantHeader: TRUSTED_TENANT_HEADER,
      serviceTokenBrowserExposed: false,
      productionPreviewBypassAllowed: false
    }
  };
}

exports.handler = async function handler(event, context) {
  const startedAt = Date.now();
  const correlationId = header(event, "x-correlation-id") || crypto.randomUUID();
  const method = String((event && event.httpMethod) || "GET").toUpperCase();
  const path = normalizedApiPath(event);

  if (method === "OPTIONS") {
    const origin = header(event, "origin");
    if (origin && !originAllowed(event, origin)) {
      return jsonResponse(
        event,
        403,
        errorEnvelope("ORIGIN_NOT_ALLOWED", "The request origin is not allowed.", correlationId),
        correlationId
      );
    }

    return {
      statusCode: 204,
      headers: {
        ...securityHeaders(event, correlationId),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Correlation-Id",
        "Access-Control-Max-Age": "600"
      },
      body: ""
    };
  }

  const origin = header(event, "origin");
  if (origin && !originAllowed(event, origin)) {
    return jsonResponse(
      event,
      403,
      errorEnvelope("ORIGIN_NOT_ALLOWED", "The request origin is not allowed.", correlationId),
      correlationId
    );
  }

  if (!routeAllowed(method, path)) {
    return jsonResponse(
      event,
      404,
      errorEnvelope("ROUTE_NOT_ALLOWED", "The requested API route is not available.", correlationId),
      correlationId
    );
  }

  if (method === "GET" && path === "/api/v1/health") {
    return jsonResponse(event, 200, healthPayload(correlationId), correlationId);
  }

  const user = authenticatedUser(context);
  const tenantId = authenticatedTenantId(user) || previewTenantId();
  if (!tenantId) {
    return jsonResponse(
      event,
      401,
      errorEnvelope("AUTHENTICATION_REQUIRED", "A valid authenticated FlipForge identity is required for data routes.", correlationId),
      correlationId,
      { "WWW-Authenticate": "Bearer realm=\"FlipForge\"" }
    );
  }

  if (!bridgeEnabled()) {
    return jsonResponse(
      event,
      503,
      errorEnvelope("BRIDGE_DISABLED", "The FlipForge API bridge is not enabled.", correlationId),
      correlationId
    );
  }

  if (!upstreamConfigured()) {
    return jsonResponse(
      event,
      503,
      errorEnvelope("UPSTREAM_NOT_CONFIGURED", "The authoritative FlipForge service is not configured.", correlationId),
      correlationId
    );
  }

  const idempotencyKey = method === "POST" ? validIdempotencyKey(header(event, "idempotency-key")) : null;
  if (method === "POST" && !idempotencyKey) {
    return jsonResponse(
      event,
      400,
      errorEnvelope("IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key is required for evaluations.", correlationId),
      correlationId
    );
  }

  const maxRequestBytes = integerFromEnv(
    "FLIPFORGE_API_MAX_REQUEST_BYTES",
    DEFAULT_MAX_REQUEST_BYTES,
    DEFAULT_MAX_REQUEST_BYTES
  );
  const body = event && event.body ? String(event.body) : "";
  if (Buffer.byteLength(body, "utf8") > maxRequestBytes) {
    return jsonResponse(
      event,
      413,
      errorEnvelope("REQUEST_TOO_LARGE", "The request body is too large.", correlationId),
      correlationId
    );
  }

  const baseUrl = String(process.env.FLIPFORGE_API_BASE_URL).replace(/\/+$/, "");
  const query = queryString(event);
  const upstreamUrl = `${baseUrl}${path}${query ? `?${query}` : ""}`;
  const timeoutMs = integerFromEnv("FLIPFORGE_API_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxResponseBytes = integerFromEnv(
    "FLIPFORGE_API_MAX_RESPONSE_BYTES",
    DEFAULT_MAX_RESPONSE_BYTES,
    DEFAULT_MAX_RESPONSE_BYTES
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${process.env.FLIPFORGE_API_SERVICE_TOKEN}`,
        "X-Correlation-Id": correlationId,
        "X-FlipForge-Contract-Version": CONTRACT_VERSION,
        [TRUSTED_TENANT_HEADER]: tenantId,
        "X-Forwarded-Proto": "https",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      body: method === "POST" ? body : undefined,
      signal: controller.signal,
      redirect: "error"
    });

    const payload = await readLimitedJson(upstreamResponse, maxResponseBytes);

    if (!upstreamResponse.ok) {
      console.warn(
        JSON.stringify({
          event: "FLIPFORGE_API_UPSTREAM_REJECTED",
          correlationId,
          method,
          path,
          upstreamStatus: upstreamResponse.status,
          durationMs: Date.now() - startedAt
        })
      );

      return jsonResponse(
        event,
        upstreamResponse.status >= 400 && upstreamResponse.status < 500 ? upstreamResponse.status : 502,
        errorEnvelope("UPSTREAM_REJECTED", "The authoritative FlipForge service rejected the request.", correlationId),
        correlationId
      );
    }

    if (!validUpstreamEnvelope(payload, correlationId, method, path)) {
      return jsonResponse(
        event,
        502,
        errorEnvelope("UPSTREAM_CONTRACT_INVALID", "The authoritative response did not satisfy the FlipForge tenant contract.", correlationId),
        correlationId
      );
    }

    console.info(
      JSON.stringify({
        event: "FLIPFORGE_API_REQUEST_COMPLETED",
        correlationId,
        method,
        path,
        upstreamStatus: upstreamResponse.status,
        durationMs: Date.now() - startedAt
      })
    );

    return jsonResponse(event, 200, payload, correlationId);
  } catch (error) {
    const timedOut = error && error.name === "AbortError";
    const code = error && error.code ? error.code : timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE";
    const message = timedOut
      ? "The authoritative FlipForge service timed out."
      : "The authoritative FlipForge service is unavailable.";

    console.error(
      JSON.stringify({
        event: "FLIPFORGE_API_REQUEST_FAILED",
        correlationId,
        method,
        path,
        code,
        durationMs: Date.now() - startedAt
      })
    );

    return jsonResponse(
      event,
      code === "UPSTREAM_RESPONSE_TOO_LARGE" ? 502 : 503,
      errorEnvelope(code, message, correlationId),
      correlationId
    );
  } finally {
    clearTimeout(timeout);
  }
};
