# FlipForge SaaS API Bridge

Status: staging tenant-gateway foundation for issues `FlipForgeWebsite#15` and `FlipForge2#205`

## Purpose

The browser-hosted SaaS interface needs a same-origin server boundary before it can consume real FlipForge data. The Netlify gateway in `netlify/functions/flipforge-api.js` provides that boundary without moving recommendation, evidence, grading, provider, or tenant-ownership logic into JavaScript.

The gateway is not the recommendation engine. It forwards authenticated requests to the authoritative FlipForge service and verifies that every successful response identifies the existing authorities and confirms tenant enforcement.

- Smart Opportunity remains the sole `BUY/WATCH/VERIFY/PASS` authority.
- Existing PSA intelligence remains the sole grading-guidance authority.
- SQLite remains the source of truth until a separate approved migration replaces it.
- The website cannot and must not open a desktop SQLite file directly.
- The browser never receives the service token, internal tenant UUID, provider credentials, or database path.

## Default behavior

The gateway fails closed by default.

| Condition | Data-route result |
|---|---|
| No verified function-context user | `401 AUTHENTICATION_REQUIRED` |
| Preview bypass requested without an explicit preview identity | `401 AUTHENTICATION_REQUIRED` |
| Evaluation missing a valid `Idempotency-Key` | `400 IDEMPOTENCY_KEY_REQUIRED` |
| Bridge disabled | `503 BRIDGE_DISABLED` |
| Upstream URL or service token missing | `503 UPSTREAM_NOT_CONFIGURED` |
| Route or method not allowlisted | `404 ROUTE_NOT_ALLOWED` |
| Upstream timeout or network failure | `503` with a non-sensitive error envelope |
| Upstream response lacks tenant-isolation proof | `502 UPSTREAM_CONTRACT_INVALID` |
| Upstream response violates authority provenance | `502 UPSTREAM_CONTRACT_INVALID` |

`GET /api/v1/health` is the only public route. It reports configuration booleans and never returns environment-variable values, tokens, URLs, customer subjects, internal tenant IDs, or provider credentials.

## Environment variables

These values belong in Netlify server environment settings. None may be placed in browser JavaScript, HTML, repository secret files, or customer-visible responses.

| Variable | Purpose |
|---|---|
| `FLIPFORGE_API_BRIDGE_ENABLED` | Must equal `true` before upstream proxying is allowed. Defaults to disabled. |
| `FLIPFORGE_API_BASE_URL` | Base URL of the authoritative FlipForge API service. |
| `FLIPFORGE_API_SERVICE_TOKEN` | Service-to-service bearer token sent only from the Netlify function. |
| `FLIPFORGE_API_ALLOWED_ORIGINS` | Optional comma-separated additional HTTPS origins. Same-origin requests are allowed automatically. |
| `FLIPFORGE_API_TIMEOUT_MS` | Upstream timeout. Defaults to 5,000 ms and is capped at 10,000 ms. |
| `FLIPFORGE_API_MAX_RESPONSE_BYTES` | Upstream JSON response limit. Defaults to and is capped at 1,000,000 bytes. |
| `FLIPFORGE_API_MAX_REQUEST_BYTES` | Evaluation-request limit. Defaults to and is capped at 65,536 bytes. |
| `FLIPFORGE_API_ALLOW_UNAUTHENTICATED_PREVIEW` | Optional non-production preview identity path. Ignored when `CONTEXT=production`. |
| `FLIPFORGE_API_PREVIEW_USER_ID` | Required pseudonymous test subject when the non-production preview identity path is enabled. Never use a real customer email or production identity. |

## Authentication and tenant boundary

Every customer data route requires a verified user in the Netlify function context. The gateway reads the trusted `user.sub` value and forwards it server-to-server as `X-FlipForge-User-Id`.

The browser cannot choose or override that value. A browser-supplied `X-FlipForge-User-Id` header is ignored because only the function-context subject is forwarded upstream.

The authoritative Java service then:

1. Hashes the external subject with SHA-256.
2. Resolves it to a stable internal tenant UUID.
3. Stores only the one-way subject hash, not the raw login subject.
4. Filters customer reads by tenant-owned resources.
5. Assigns a newly evaluated opportunity to the submitting tenant.
6. Returns `404 RESOURCE_NOT_FOUND` for cross-tenant resource probes.

A non-production preview identity can be used only when both preview variables are explicitly configured. Production ignores that bypass completely.

This phase does not add signup screens, password recovery, billing, paid plans, or entitlement enforcement. It establishes the identity handoff and data-isolation layer those later features depend on.

## Evaluation idempotency

`POST /api/v1/evaluations` requires an `Idempotency-Key` containing 8–100 safe characters.

- The gateway validates and forwards the key.
- The authoritative service scopes the key by internal tenant.
- The same tenant and same request replay safely.
- The same tenant and changed request conflict.
- Two different tenants may independently use the same key.
- Keys and saved results remain in persistent SQLite.

## Route allowlist

The gateway accepts only these contracts:

- `GET /api/v1/health`
- `GET /api/v1/dashboard`
- `GET /api/v1/opportunities`
- `GET /api/v1/opportunities/{id}`
- `GET /api/v1/compare?ids=`
- `GET /api/v1/psa-advisor/{id}`
- `GET /api/v1/evidence/{id}`
- `GET /api/v1/portfolio`
- `GET /api/v1/alerts`
- `GET /api/v1/account`
- `GET /api/v1/entitlements`
- `POST /api/v1/evaluations`

No route exists for provider administration, credential entry, evidence acceptance, recommendation recalculation, grade prediction, bidding, checkout, marketplace listing, payment collection, or purchase authorization.

## Response contract

Successful upstream responses must satisfy `contracts/flipforge-saas-api-v1.schema.json` and include:

- `meta.contractVersion = "1.0"`
- a non-empty `meta.engineVersion`
- `meta.authority = "Smart Opportunity"`
- `meta.gradingAuthority = "Existing PSA intelligence"`
- `meta.generatedAt`
- the exact request `meta.correlationId`
- a `data` property

Tenant-specific read responses must also include `data.tenantIsolationEnforced = true`. Evaluation responses must include `data.tenantScoped = true`. The gateway rejects successful upstream responses that omit those safeguards.

## Security controls in this phase

- Same-origin server-side gateway
- Explicit route and method allowlist
- Verified function-context identity required for every customer route
- Browser tenant-header spoofing ignored
- One-way external-subject mapping in the authoritative service
- Tenant ownership checks on every customer-visible opportunity route
- Tenant-scoped evaluation idempotency
- Production-safe preview guard with explicit preview identity
- Upstream service token stored and used only on the server
- Server-added HTTPS proxy marker
- Request and response size limits
- Abortable upstream timeout
- Redirect refusal
- Strict JSON parsing
- Contract, authority, and tenant-isolation validation
- Correlation IDs
- No-store cache policy
- Non-sensitive logs and errors
- No provider-specific secret returned to the browser

## Staging activation sequence

1. Validate the matched backend and gateway tenant-isolation branches locally.
2. Review both draft pull requests and merge only after zero-failure evidence.
3. Select an approved staging host with persistent storage, HTTPS, secrets, health checks, and rollback.
4. Deploy the already validated container to staging only.
5. Configure the staging gateway upstream URL and server-only token.
6. Use two test accounts to prove each account can see only its own records.
7. Verify restart persistence, backup, restore, and failure modes.
8. Review actual desktop and mobile staging screens.
9. Obtain separate owner approval before any production activation.

The live SaaS prototype continues using explicit mock data until those gates pass. This branch does not deploy, enable the production bridge, activate billing, or expose live customer data.
