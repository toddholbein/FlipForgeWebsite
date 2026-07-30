import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const require = createRequire(import.meta.url);

function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

const files = {
  gateway: read("netlify/functions/flipforge-api.js"),
  redirects: read("_redirects"),
  contract: read("contracts/flipforge-saas-api-v1.schema.json"),
  docs: read("docs/SAAS_API_BRIDGE.md"),
  prototypeIndex: read("saas-prototype/index.html"),
  prototypeApp: read("saas-prototype/app.js"),
  prototypeData: read("saas-prototype/mock-data.js")
};

const results = [];
function check(name, condition) {
  results.push({ name, passed: Boolean(condition) });
}
function jsonBody(response) {
  return JSON.parse(response.body || "{}");
}
function isolation(overrides = {}) {
  return {
    enforced: true,
    defaultAccess: "DENY",
    tenantAuditKey: "012345abcdef",
    ...overrides
  };
}

check("001 API redirect targets the server-side function", files.redirects.includes("/api/v1/* /.netlify/functions/flipforge-api 200"));
check("002 gateway is disabled unless explicitly enabled", files.gateway.includes('FLIPFORGE_API_BRIDGE_ENABLED || ""') && files.gateway.includes('=== "true"'));
check("003 upstream base URL comes from server environment", files.gateway.includes("process.env.FLIPFORGE_API_BASE_URL"));
check("004 service token comes from server environment", files.gateway.includes("process.env.FLIPFORGE_API_SERVICE_TOKEN"));
check("005 service token is used only in upstream Authorization", /Authorization:\s*`Bearer \$\{process\.env\.FLIPFORGE_API_SERVICE_TOKEN\}`/.test(files.gateway));
check("006 trusted tenant header matches authoritative backend", files.gateway.includes('TRUSTED_TENANT_HEADER = "X-FlipForge-Tenant-Id"'));
check("007 authenticated subject is constrained to backend-safe format", files.gateway.includes("validTrustedTenantId") && files.gateway.includes("{2,127}"));
check("008 customer routes require function-context authentication", files.gateway.includes("context.clientContext.user") && files.gateway.includes("AUTHENTICATION_REQUIRED"));
check("009 production preview bypass is impossible", files.gateway.includes('context !== "production"') && files.gateway.includes("productionPreviewBypassAllowed: false"));
check("010 preview bypass requires explicit tenant id", files.gateway.includes("FLIPFORGE_API_PREVIEW_TENANT_ID") && files.gateway.includes("previewTenantId()"));
check("011 route access uses an explicit allowlist", files.gateway.includes("const ROUTES = [") && files.gateway.includes("routeAllowed(method, path)"));
check("012 gateway exposes no provider or transaction route", !/provider-admin|credential-entry|accept-evidence|auto-buy|checkout/i.test(files.gateway));
check("013 request bodies have a fixed size limit", files.gateway.includes("DEFAULT_MAX_REQUEST_BYTES") && files.gateway.includes("REQUEST_TOO_LARGE"));
check("014 upstream responses have a fixed size limit", files.gateway.includes("DEFAULT_MAX_RESPONSE_BYTES") && files.gateway.includes("UPSTREAM_RESPONSE_TOO_LARGE"));
check("015 upstream requests use an AbortController timeout", files.gateway.includes("new AbortController()") && files.gateway.includes("controller.abort()"));
check("016 upstream redirects are refused", files.gateway.includes('redirect: "error"'));
check("017 authoritative responses are contract validated", files.gateway.includes("validUpstreamEnvelope") && files.gateway.includes("UPSTREAM_CONTRACT_INVALID"));
check("018 Smart Opportunity authority is required", files.gateway.includes('meta.authority !== "Smart Opportunity"'));
check("019 existing PSA authority is required", files.gateway.includes('meta.gradingAuthority !== "Existing PSA intelligence"'));
check("020 nested tenant isolation is required", files.gateway.includes("validTenantIsolation") && files.gateway.includes("isolation.enforced === true"));
check("021 default-deny tenant access is required", files.gateway.includes('isolation.defaultAccess === "DENY"'));
check("022 bounded tenant audit key is required", files.gateway.includes("^[a-f0-9]{12}$"));
check("023 tenant-owned evaluation result is required", files.gateway.includes("payload.data.tenantOwned === true"));
check("024 tenant evaluation idempotency scope is required", files.gateway.includes('idempotencyScope === "TENANT"'));
check("025 evaluation ownership grant is required", files.gateway.includes('opportunityOwnership === "GRANTED_ON_COMPLETION"'));
check("026 evaluation cannot authorize transaction", files.gateway.includes("payload.data.transactionAuthorized === false"));
check("027 correlation IDs are generated or preserved", files.gateway.includes("crypto.randomUUID()") && files.gateway.includes('header(event, "x-correlation-id")'));
check("028 correlation ID is forwarded upstream", files.gateway.includes('"X-Correlation-Id": correlationId'));
check("029 trusted tenant context is forwarded server-side", files.gateway.includes("[TRUSTED_TENANT_HEADER]: tenantId"));
check("030 HTTPS proxy marker is set server-side", files.gateway.includes('"X-Forwarded-Proto": "https"'));
check("031 evaluation idempotency key is validated", files.gateway.includes("validIdempotencyKey") && files.gateway.includes("IDEMPOTENCY_KEY_REQUIRED"));
check("032 evaluation idempotency key is forwarded", files.gateway.includes('"Idempotency-Key": idempotencyKey'));
check("033 browser preflight allows Idempotency-Key", files.gateway.includes("Content-Type, Idempotency-Key, X-Correlation-Id"));
check("034 API responses disable caching", files.gateway.includes('"Cache-Control": "no-store, max-age=0"'));
check("035 security headers include nosniff and no-referrer", files.gateway.includes('"X-Content-Type-Options": "nosniff"') && files.gateway.includes('"Referrer-Policy": "no-referrer"'));
check("036 cross-origin requests are explicitly checked", files.gateway.includes("originAllowed(event, origin)") && files.gateway.includes("ORIGIN_NOT_ALLOWED"));
check("037 logs contain route metadata but not body or tenant", files.gateway.includes("FLIPFORGE_API_REQUEST_COMPLETED") && !/console\.(?:info|warn|error)\([^)]*(?:body|tenantId|user\.sub)/s.test(files.gateway));
check("038 gateway never returns the service token", !/FLIPFORGE_API_SERVICE_TOKEN[^\n]{0,120}(?:body|jsonResponse|errorEnvelope)/.test(files.gateway));
check("039 browser tenant header is never read", !files.gateway.includes('header(event, "x-flipforge-tenant-id")'));
check("040 old incompatible user-id header is absent", !files.gateway.includes("X-FlipForge-User-Id"));
check("041 v1 JSON schema parses", (() => { try { JSON.parse(files.contract); return true; } catch (_) { return false; } })());

const contract = JSON.parse(files.contract);
const requiredMeta = contract.properties?.meta?.required || [];
check("042 schema requires contract version", requiredMeta.includes("contractVersion"));
check("043 schema requires engine version", requiredMeta.includes("engineVersion"));
check("044 schema requires authority provenance", requiredMeta.includes("authority") && requiredMeta.includes("gradingAuthority"));
check("045 schema requires timestamp and correlation ID", requiredMeta.includes("generatedAt") && requiredMeta.includes("correlationId"));
check("046 schema fixes Smart Opportunity authority", contract.properties?.meta?.properties?.authority?.const === "Smart Opportunity");
check("047 schema fixes existing PSA authority", contract.properties?.meta?.properties?.gradingAuthority?.const === "Existing PSA intelligence");
check("048 docs state gateway is not recommendation engine", files.docs.includes("The gateway is not the recommendation engine"));
check("049 docs identify trusted backend header", files.docs.includes("X-FlipForge-Tenant-Id"));
check("050 docs forbid direct desktop SQLite access", files.docs.includes("must not open a desktop SQLite file directly"));
check("051 docs require separate production approval", files.docs.includes("separate owner approval before any production activation"));
check("052 prototype remains explicitly mock-backed", files.prototypeData.includes("Local mock responses shaped like future read-only API contracts"));
check("053 browser app still contains no direct fetch", !/\bfetch\s*\(/.test(`${files.prototypeIndex}\n${files.prototypeApp}\n${files.prototypeData}`));
check("054 browser files contain no service token", !/FLIPFORGE_API_SERVICE_TOKEN/.test(`${files.prototypeIndex}\n${files.prototypeApp}\n${files.prototypeData}`));

const environmentNames = [
  "FLIPFORGE_API_BRIDGE_ENABLED",
  "FLIPFORGE_API_BASE_URL",
  "FLIPFORGE_API_SERVICE_TOKEN",
  "FLIPFORGE_API_ALLOWED_ORIGINS",
  "FLIPFORGE_API_TIMEOUT_MS",
  "FLIPFORGE_API_MAX_RESPONSE_BYTES",
  "FLIPFORGE_API_MAX_REQUEST_BYTES",
  "FLIPFORGE_API_ALLOW_UNAUTHENTICATED_PREVIEW",
  "FLIPFORGE_API_PREVIEW_TENANT_ID",
  "CONTEXT"
];
const originalEnvironment = Object.fromEntries(environmentNames.map(name => [name, process.env[name]]));
const originalFetch = globalThis.fetch;

function clearBridgeEnvironment() {
  for (const name of environmentNames) delete process.env[name];
}
function event(method, pathName, overrides = {}) {
  return {
    httpMethod: method,
    path: pathName,
    headers: {
      host: "deploy-preview-tenant--goflipforge.netlify.app",
      ...(overrides.headers || {})
    },
    queryStringParameters: overrides.queryStringParameters || {},
    body: overrides.body || ""
  };
}
function context(subject) {
  return subject ? { clientContext: { user: { sub: subject } } } : {};
}
function envelope(correlationId, data, authority = "Smart Opportunity") {
  return {
    meta: {
      contractVersion: "1.0",
      engineVersion: "test-engine",
      authority,
      gradingAuthority: "Existing PSA intelligence",
      generatedAt: "2026-07-30T12:00:00Z",
      correlationId,
      evidenceFreshness: "current",
      limitations: ["test fixture"]
    },
    data
  };
}

try {
  clearBridgeEnvironment();
  const gatewayPath = path.join(repositoryRoot, "netlify/functions/flipforge-api.js");
  delete require.cache[require.resolve(gatewayPath)];
  const { handler } = require(gatewayPath);

  const health = await handler(event("GET", "/api/v1/health"), {});
  const healthBody = jsonBody(health);
  check("055 public health succeeds while disabled", health.statusCode === 200 && healthBody.data?.status === "disabled");
  check("056 health reveals no configured URL or secret values",
    !health.body.includes("authoritative.example.invalid") &&
    !health.body.includes("server-only-test-token") &&
    !health.body.includes("preview-tenant"));
  check("057 health reports trusted tenant handoff", healthBody.data?.trustedTenantContextForwardedServerSide === true);
  check("058 health identifies only the non-secret tenant header contract", healthBody.data?.trustedTenantHeader === "X-FlipForge-Tenant-Id");

  const unauthenticated = await handler(event("GET", "/api/v1/dashboard"), {});
  check("059 unauthenticated data route fails closed", unauthenticated.statusCode === 401 && jsonBody(unauthenticated).error?.code === "AUTHENTICATION_REQUIRED");

  const invalidAuthenticatedSubject = await handler(event("GET", "/api/v1/dashboard"), context("invalid@email.test"));
  check("060 invalid authenticated subject fails closed", invalidAuthenticatedSubject.statusCode === 401);

  const unknown = await handler(event("GET", "/api/v1/provider-admin"), {});
  check("061 unknown route rejected before authentication", unknown.statusCode === 404 && jsonBody(unknown).error?.code === "ROUTE_NOT_ALLOWED");

  const foreignOrigin = await handler(event("GET", "/api/v1/health", { headers: { origin: "https://example.invalid" } }), {});
  check("062 foreign origin is rejected", foreignOrigin.statusCode === 403 && jsonBody(foreignOrigin).error?.code === "ORIGIN_NOT_ALLOWED");

  const options = await handler(
    event("OPTIONS", "/api/v1/dashboard", { headers: { origin: "https://deploy-preview-tenant--goflipforge.netlify.app" } }),
    {}
  );
  check("063 same-origin preflight succeeds", options.statusCode === 204 && options.headers["Access-Control-Allow-Headers"].includes("Idempotency-Key"));
  check("064 preflight does not allow browser tenant header", !options.headers["Access-Control-Allow-Headers"].includes("X-FlipForge-Tenant-Id"));

  process.env.CONTEXT = "production";
  process.env.FLIPFORGE_API_ALLOW_UNAUTHENTICATED_PREVIEW = "true";
  process.env.FLIPFORGE_API_PREVIEW_TENANT_ID = "preview-tenant";
  const productionBypass = await handler(event("GET", "/api/v1/dashboard"), {});
  check("065 production ignores preview tenant bypass", productionBypass.statusCode === 401);

  process.env.CONTEXT = "deploy-preview";
  delete process.env.FLIPFORGE_API_PREVIEW_TENANT_ID;
  const previewWithoutIdentity = await handler(event("GET", "/api/v1/dashboard"), {});
  check("066 preview bypass requires explicit tenant id", previewWithoutIdentity.statusCode === 401);

  process.env.FLIPFORGE_API_PREVIEW_TENANT_ID = "preview-tenant";
  const previewDisabled = await handler(event("GET", "/api/v1/dashboard"), {});
  check("067 preview tenant still respects bridge-disabled state", previewDisabled.statusCode === 503 && jsonBody(previewDisabled).error?.code === "BRIDGE_DISABLED");

  process.env.FLIPFORGE_API_BRIDGE_ENABLED = "true";
  const missingUpstream = await handler(event("GET", "/api/v1/dashboard"), context("tenant-user-a"));
  check("068 enabled bridge fails when upstream missing", missingUpstream.statusCode === 503 && jsonBody(missingUpstream).error?.code === "UPSTREAM_NOT_CONFIGURED");

  process.env.FLIPFORGE_API_BASE_URL = "https://authoritative.example.invalid";
  process.env.FLIPFORGE_API_SERVICE_TOKEN = "server-only-test-token";
  process.env.FLIPFORGE_API_MAX_REQUEST_BYTES = "65536";

  const missingKey = await handler(
    event("POST", "/api/v1/evaluations", { body: JSON.stringify({ externalListingId: "1" }) }),
    context("tenant-user-a")
  );
  check("069 evaluation without idempotency key fails before upstream", missingKey.statusCode === 400 && jsonBody(missingKey).error?.code === "IDEMPOTENCY_KEY_REQUIRED");

  process.env.FLIPFORGE_API_MAX_REQUEST_BYTES = "16";
  const oversized = await handler(
    event("POST", "/api/v1/evaluations", {
      headers: { "idempotency-key": "request-oversized" },
      body: JSON.stringify({ value: "12345678901234567890" })
    }),
    context("tenant-user-a")
  );
  check("070 oversized evaluation rejected before upstream", oversized.statusCode === 413 && jsonBody(oversized).error?.code === "REQUEST_TOO_LARGE");

  process.env.FLIPFORGE_API_MAX_REQUEST_BYTES = "65536";
  let capturedUrl = null;
  let capturedHeaders = null;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return new Response(
      JSON.stringify(envelope(options.headers["X-Correlation-Id"], {
        kind: "dashboard",
        metrics: {},
        opportunities: [],
        tenantIsolation: isolation({ visibleOpportunityCount: 0 })
      })),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  const successful = await handler(
    event("GET", "/api/v1/dashboard", {
      headers: {
        "x-correlation-id": "tenant-gateway-correlation",
        "x-flipforge-tenant-id": "malicious-browser-tenant"
      }
    }),
    context("verified-tenant-a")
  );
  check("071 tenant-isolated authoritative response passes", successful.statusCode === 200 && jsonBody(successful).data?.tenantIsolation?.enforced === true);
  check("072 service token forwarded server-to-server", capturedHeaders.Authorization === "Bearer server-only-test-token");
  check("073 verified function subject overrides browser spoof", capturedHeaders["X-FlipForge-Tenant-Id"] === "verified-tenant-a");
  check("074 old user-id header is not forwarded", capturedHeaders["X-FlipForge-User-Id"] === undefined);
  check("075 HTTPS proxy marker forwarded", capturedHeaders["X-Forwarded-Proto"] === "https");
  check("076 correlation ID forwarded", capturedHeaders["X-Correlation-Id"] === "tenant-gateway-correlation");
  check("077 gateway forwards only allowed upstream URL", capturedUrl === "https://authoritative.example.invalid/api/v1/dashboard");
  check("078 browser response excludes service token and raw tenant", !successful.body.includes("server-only-test-token") && !successful.body.includes("verified-tenant-a"));

  let capturedEvaluationHeaders = null;
  globalThis.fetch = async (_url, options) => {
    capturedEvaluationHeaders = options.headers;
    return new Response(
      JSON.stringify(envelope(options.headers["X-Correlation-Id"], {
        kind: "evaluation",
        tenantOwned: true,
        transactionAuthorized: false,
        tenantIsolation: isolation({
          idempotencyScope: "TENANT",
          opportunityOwnership: "GRANTED_ON_COMPLETION"
        })
      })),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const evaluation = await handler(
    event("POST", "/api/v1/evaluations", {
      headers: { "Idempotency-Key": "evaluation-request-001" },
      body: JSON.stringify({ externalListingId: "test" })
    }),
    context("verified-tenant-b")
  );
  check("079 tenant-owned evaluation response passes", evaluation.statusCode === 200 && jsonBody(evaluation).data?.tenantOwned === true);
  check("080 idempotency key forwarded unchanged", capturedEvaluationHeaders["Idempotency-Key"] === "evaluation-request-001");
  check("081 evaluation tenant forwarded through trusted header", capturedEvaluationHeaders["X-FlipForge-Tenant-Id"] === "verified-tenant-b");

  globalThis.fetch = async (_url, options) => new Response(
    JSON.stringify(envelope(options.headers["X-Correlation-Id"], { metrics: [] })),
    { status: 200, headers: { "content-type": "application/json" } }
  );
  const missingTenantMarker = await handler(event("GET", "/api/v1/dashboard"), context("tenant-user-a"));
  check("082 upstream read without tenant isolation is rejected", missingTenantMarker.statusCode === 502 && jsonBody(missingTenantMarker).error?.code === "UPSTREAM_CONTRACT_INVALID");

  globalThis.fetch = async (_url, options) => new Response(
    JSON.stringify(envelope(options.headers["X-Correlation-Id"], {
      tenantIsolation: isolation({ defaultAccess: "ALLOW" })
    })),
    { status: 200, headers: { "content-type": "application/json" } }
  );
  const allowByDefault = await handler(event("GET", "/api/v1/dashboard"), context("tenant-user-a"));
  check("083 upstream allow-by-default response is rejected", allowByDefault.statusCode === 502 && jsonBody(allowByDefault).error?.code === "UPSTREAM_CONTRACT_INVALID");

  globalThis.fetch = async (_url, options) => new Response(
    JSON.stringify(envelope(options.headers["X-Correlation-Id"], {
      tenantIsolation: isolation()
    }, "Second Recommendation Engine")),
    { status: 200, headers: { "content-type": "application/json" } }
  );
  const invalidAuthority = await handler(event("GET", "/api/v1/dashboard"), context("tenant-user-a"));
  check("084 second recommendation authority is rejected", invalidAuthority.statusCode === 502 && jsonBody(invalidAuthority).error?.code === "UPSTREAM_CONTRACT_INVALID");
} finally {
  globalThis.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

const failures = results.filter(result => !result.passed);
console.log("SaaSApiBridgeValidation");
console.log(`PASSED: ${results.length - failures.length}`);
console.log(`FAILED: ${failures.length}`);
for (const failure of failures) console.error(`FAIL | ${failure.name}`);
if (failures.length > 0) process.exitCode = 1;
