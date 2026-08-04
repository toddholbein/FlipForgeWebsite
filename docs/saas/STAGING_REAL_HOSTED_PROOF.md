# FlipForge Real Hosted Staging Proof

Status: NON-PRODUCTION VALIDATION ONLY

This pull request exists to create a fresh Netlify Deploy Preview from current `main` after the non-production gateway environment was pointed at the Render staging backend.

It changes no production routing, authentication, billing authority, recommendation authority, PSA authority, evidence authority, or transaction authority.

The staging proof should verify:

1. the deploy-preview gateway reports `bridgeEnabled=true` and `upstreamConfigured=true`;
2. production preview bypass remains disabled;
3. signed Netlify Identity membership supplies tenant context;
4. the gateway forwards only server-owned `X-FlipForge-Tenant-Id` and service-token credentials;
5. Render answers through the current v15.x authoritative API;
6. two distinct tenant identities cannot read or mutate each other's governed data;
7. Paddle checkout remains fail-closed until sandbox provider configuration is explicitly connected;
8. the Paddle webhook remains excluded from the customer gateway;
9. no browser receives the Render service token, Paddle secret, or raw tenant identity header;
10. production remains disabled.

Do not merge this proof PR solely to keep a preview alive. It may be closed after hosted staging evidence is captured.
