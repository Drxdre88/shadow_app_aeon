# HANDOVER — "No response is returned from route handler" (claude.ai connector + systemic)

**Date:** 2026-06-06 (~00:30 local)
**Branch/commit:** `main` @ `aa1b1de` (deployed to prod, Vercel "Ready/Production")
**Status:** Connector intermittently fails; root cause is NOT the OAuth code. Under investigation.

---

## 1. Original goal
Connect Aeon's remote MCP server to **claude.ai** via the new OAuth 2.1 connector
(`https://aeon.shadow-lab.ai/api/mcp`, blank client id/secret → Dynamic Client Registration + PKCE).

claude.ai shows: *"Couldn't register with Aeon's sign-in service… reference ofid_…"*

## 2. The actual error (from Vercel runtime logs)
```
Error: No response is returned from route handler '…/route.ts'.
Ensure you return a `Response` or a `NextResponse` in all branches of your handler.
```
Intermittent, **load/concurrency-correlated**. Hits MULTIPLE unrelated routes:
- `/.well-known/oauth-authorization-server`  (no DB, no wrappers)
- `/.well-known/oauth-protected-resource` (+ the `/api/mcp`-suffixed rewrite variant)
- `/api/v1/memories` (POST) — **flooded ~3×/sec at 00:16–00:17, retry storm**
- `/api/v1/projects/resolve` (GET)

## 3. What we proved
- **claude.ai DID connect** — at `00:16:57` logs show `POST /api/mcp → 200` and `→ 202`
  (successful *authenticated* MCP calls). So the OAuth flow works when the runtime isn't dropping responses.
- **The app code is NOT the bug.** Read the handlers + wrappers:
  - `lib/api/auth.ts` `apiHandler()` → try/catch, always returns (jsonError 500 on throw).
  - `lib/api/rateLimit.ts` `withRateLimit()` → returns 429 or the handler's response. No `undefined` path.
  - well-known handlers → single `return Response.json(...)`, no branches.
  All provably return a Response. "No response is returned" means the **Next/Vercel runtime**
  isn't receiving it → client aborted the request, or the function was killed/timed out under load.
- **Local reproduction is clean:** `npm run dev` → well-known 200, register 201 (writes a real
  `oauth_clients` row to the prod Neon DB). Schema/migration 0022 IS applied to prod.
- **`ppr` is NOT enabled** in `next.config.ts` (only `reactCompiler: true`, `serverActions`,
  `turbopackUseSystemTlsCerts`). So the earlier "PPR prerender" theory was wrong.

## 4. Fix already applied (commit aa1b1de) — PARTIAL, did not resolve
Added `export const dynamic = 'force-dynamic'` to 5 OAuth routes:
`well-known/oauth-authorization-server`, `well-known/oauth-protected-resource`,
`oauth/authorize`, `oauth/register`, `oauth/token`.
→ Reduced well-known failures under sequential/burst curl tests (lots of 200s at 00:07),
but claude.ai still hit a 500 on auth-server at 00:09:40, and the systemic v1 errors are unaffected.
NOTE: live well-known still returns `Cache-Control: public, max-age=0, must-revalidate`
(static-optimization signature) — unclear if force-dynamic actually took effect in the deployed build
(possible Vercel build-cache staleness — try redeploy with build cache OFF to confirm).

## 5. Leading root-cause hypotheses (for next session)
1. **DB connection-pool exhaustion under load.** `lib/db/index.ts` Pool is `max: 10`,
   `connectionTimeoutMillis: 20000`. The `/api/v1/memories` retry storm (3×/sec) exhausts the pool →
   requests hang 20s → callers time out & disconnect → Next logs "No response is returned" →
   collateral load makes discovery routes flake too. **(strongest)**
2. **A runaway client / retry storm** hammering `/api/v1/memories` + `/api/v1/projects/resolve`
   (comment in projects/resolve: "used by the Brain capture pipeline / per-repo session captures").
   Find what's firing it — likely a Kairos cron, session-capture hook, or MCP memory tool in a loop.
   It may be creating duplicate memories (write may succeed server-side before the response is lost).
3. **Next.js 16.1.4 runtime/Turbopack bug** — "No response is returned" intermittently under
   concurrency across handler types. Check for known issue + patch upgrade.

## 6. Recommended next steps (in order)
1. **Find & stop the `/api/v1/memories` storm.** Who's POSTing 3×/sec? (grep for clients hitting
   `/api/v1/memories`: Kairos crons in `apps/web/src/app/api/cron/*`, session hooks, `.aeonrc`,
   the Brain capture pipeline.) Check for duplicate memories created during the storm.
2. **Raise DB pool** `max` well above 10 (Neon pooler can take more) and/or shorten the query path.
3. **Confirm force-dynamic actually deployed** — redeploy aa1b1de with "Use existing Build Cache"
   UNCHECKED; re-check that well-known no longer returns `public, max-age=0` and survives a
   heavy CONCURRENT burst (not sequential).
4. **Research** the Next 16.1.4 "No response is returned from route handler" under-load issue.
5. Re-test claude.ai connector: **delete the connector entirely and re-add fresh** (it caches the
   failed client registration — old `ofid_…` references).

## 7. Key facts / gotchas
- **claude.ai = "OAuth-only MCP client"** (per the d896e0c commit msg). Its custom-connector UI has
  NO field for a static Bearer token — that's why the OAuth server exists. You CANNOT shortcut it
  the way Claude Code's `mcp.json` does (`Authorization: Bearer aeon_k1_…`). Don't go down that path.
- Prod base URL: `https://aeon.shadow-lab.ai`. `.env.local` `DATABASE_URL` points at the prod Neon DB
  (`ep-delicate-cherry-a9vpyot9-pooler.gwc.azure.neon.tech`).
- `next.config.ts` rewrites `/.well-known/oauth-*` → `/api/well-known/oauth-*` (App Router won't serve
  dot-folders). The `:path*` variant handles claude.ai's `/.well-known/oauth-protected-resource/api/mcp`.
- MCP transport `/api/[transport]/route.ts` uses `mcp-handler` (`withMcpAuth`) — returns 401 challenge
  with correct `resource_metadata`. This part is healthy; left untouched.
- OAuth token verify path: `verifyOAuthAccessToken` accepts `aeon_at_` tokens alongside `aeon_k1_` keys
  in `authenticateRequest` (`lib/api/auth.ts`).

## 8. Useful commands
```bash
# Check deploy status / which build serves prod
gh api repos/Drxdre88/shadow_app_aeon/deployments?per_page=5 \
  --jq '.[] | "\(.environment) sha=\(.sha[0:7]) id=\(.id)"'
gh api repos/Drxdre88/shadow_app_aeon/commits/<sha>/status --jq '.state'

# Probe discovery chain
curl -s -D - https://aeon.shadow-lab.ai/.well-known/oauth-authorization-server
curl -s -X POST https://aeon.shadow-lab.ai/api/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"client_name":"probe"}'

# Heavy CONCURRENT burst (this is what reproduces the failure, not sequential)
for i in $(seq 1 30); do curl -s -o /dev/null -w "%{http_code} " \
  https://aeon.shadow-lab.ai/.well-known/oauth-authorization-server & done; wait
```
