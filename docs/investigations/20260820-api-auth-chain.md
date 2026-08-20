# API Bearer-Token Auth Chain — Recon

**Date:** 2026-08-20
**Scope:** `apps/web/src/lib/api/auth.ts` — end-to-end trace of `authenticateRequest()`
**Mode:** Read-only recon, no code changes.

## Summary

`authenticateRequest()` in `apps/web/src/lib/api/auth.ts:20-57` is the single bearer-token
auth chokepoint used by every `/api/v1/*` REST route (69 route files, VERIFIED via grep)
and the MCP `[transport]` route (`apps/web/src/app/api/[transport]/route.ts`, VERIFIED).
It resolves an incoming request to `{ id: string; role: string } | Response` where a
`Response` return short-circuits the caller with a 401.

## Entry point

`apps/web/src/lib/api/auth.ts:23-24` — VERIFIED
```ts
const authHeader = request.headers.get('authorization')
if (authHeader?.startsWith('Bearer ')) {
  const token = authHeader.slice(7)
```
If the header is present and starts with `Bearer `, control enters the token-prefix chain
(lines 24-49). If absent (or a non-`Bearer` scheme), control falls through to the
session-cookie fallback (lines 51-56). **There is no fallback to the session cookie once
a `Bearer` header is present** — an invalid/expired bearer token returns 401 directly
(line 48) and never tries `auth()`. VERIFIED.

## Resolution order (exact, as coded)

1. **Master key** — `auth.ts:27-31` — VERIFIED
   ```ts
   const masterKey = process.env.AEON_API_KEY
   const adminId = process.env.AEON_API_USER_ID
   if (masterKey && adminId && constantTimeCompare(token, masterKey)) {
     return { id: adminId, role: 'admin' }
   }
   ```
   - Checked **unconditionally first**, regardless of the token's prefix/shape.
   - `constantTimeCompare` (`auth.ts:15-18`) rejects on length mismatch via a plain `!==`
     before calling `timingSafeEqual` — this leaks token *length* through timing, but not
     content. Standard/low-risk pattern (INFERRED: acceptable trade-off, not a bug).
   - Resolves to a synthetic admin identity `{ id: adminId, role: 'admin' }` — not backed
     by a DB lookup. `adminId` is an operator-supplied env var, not necessarily a real
     `users.id` row. INFERRED: any code path assuming `id` FK-references `users` could
     misbehave for this identity (e.g. joins expecting a matching `projectMembers` row).

2. **`aeon_k1_` — API keys** — `auth.ts:33-36` → `apps/web/src/lib/data/api-keys.ts:39-64` — VERIFIED
   - Guarded by `token.startsWith('aeon_k1_')`.
   - `verifyApiKey()`: takes the first 10 chars as `keyPrefix` (`api-keys.ts:42`), looks up
     all non-revoked (`isNull(revokedAt)`) rows sharing that prefix, then SHA-256 hashes
     the full token and does a `timingSafeEqual` compare against each candidate's stored
     `keyHash` (`api-keys.ts:43-53`).
   - On match: fire-and-forget `lastUsedAt` update (`.catch(() => {})`, no `await`) —
     VERIFIED not to block the response.
   - Resolves to `{ id: result.userId, role: 'user' }` (`auth.ts:35`) — **role is always
     hardcoded to `'user'`**, even if the underlying `users.role` is `'admin'`. INFERRED
     risk: an admin who authenticates via an `aeon_k1_` API key loses admin role for that
     request; any admin-gated route relying on `ApiUser.role` here would deny them. This
     differs from the session-cookie path, which forwards the real `session.user.role`
     (line 56).
   - No expiry column checked in `verifyApiKey` (INFERRED from schema query — only
     `revokedAt IS NULL` is filtered; no `expiresAt` field is referenced) — API keys
     appear to be non-expiring until explicitly revoked. VERIFIED from the query shape;
     INFERRED as intentional (matches "API key" semantics vs. session/token semantics).

3. **`aeon_s1_` — mobile sessions** — `auth.ts:38-41` → `apps/web/src/lib/data/mobile-auth.ts:71-90` — VERIFIED
   - Guarded by `token.startsWith('aeon_s1_')`.
   - `verifyMobileSession()`: SHA-256 hashes the token, looks up `mobileSessions` by
     `tokenHash` **and** `expiresAt > now()` (`mobile-auth.ts:76-87`) — unlike API keys,
     mobile sessions DO expire (90-day TTL, `SESSION_EXPIRY` at `mobile-auth.ts:8`).
   - No `lastUsedAt`/touch write on success (VERIFIED by absence in the function) —
     asymmetric with the API-key and OAuth-token paths, which both update a last-used
     timestamp. INFERRED: minor observability gap, not a security issue.
   - Resolves to `{ id: result.userId, role: 'user' }` (`auth.ts:40`) — same hardcoded
     `role: 'user'` caveat as above.
   - Session tokens are minted by `createMobileSession()` (`mobile-auth.ts:56-69`), itself
     gated upstream by a short-lived (10 min) magic-link-style login token
     (`createLoginToken`/`verifyLoginToken`, lines 14-54) — VERIFIED as the mobile
     login flow, not part of the bearer chain itself but its issuance path.

4. **`aeon_at_` — OAuth access tokens** — `auth.ts:43-46` → `apps/web/src/lib/data/oauth.ts:125-151` — VERIFIED
   - Guarded by `token.startsWith('aeon_at_')`.
   - `verifyOAuthAccessToken()`: SHA-256 hash lookup against `oauthAccessTokens.tokenHash`,
     filtered to `revokedAt IS NULL` (`oauth.ts:130-134`), then an explicit expiry check
     `row.expiresAt.getTime() < Date.now()` (`oauth.ts:136`) — 30-day access-token TTL
     (`ACCESS_TTL_MS`, `oauth.ts:7`).
   - `lastUsedAt` is throttled to one DB write per 60s of activity (`oauth.ts:138-148`,
     explicitly commented as a pool-exhaustion mitigation) — the only one of the three
     verify functions with this throttle; API keys write unconditionally on every hit,
     mobile sessions never write. INFERRED: intentional given OAuth tokens are expected
     to be the highest-QPS path (used by external/agent clients), but the inconsistency
     means "last used" freshness differs in meaning across the three token types.
   - Resolves to `{ id: result.userId, role: 'user' }` (`auth.ts:45`) — same hardcoded
     `role: 'user'`; note this function also returns a `scope` field
     (`{ userId, scope }`) that `authenticateRequest` silently discards — OAuth scope is
     **not currently enforced** at this layer. INFERRED risk: any narrower-scoped OAuth
     token (e.g. read-only) is granted the same effective access as a full-scope token,
     since `ApiUser` has no `scope` field and downstream code only sees `{ id, role }`.
   - Full OAuth surface (DCR client registration, PKCE auth-code exchange, refresh-token
     rotation) lives in the rest of `oauth.ts` (lines 1-123) — VERIFIED present but out of
     scope for the bearer-verification chain itself.

5. **Fallthrough — no prefix matched / all verifies failed** — `auth.ts:48` — VERIFIED
   ```ts
   return jsonResponse({ error: 'Invalid API key' }, { status: 401 })
   ```
   Reached whenever a `Bearer` header exists but the token matched none of the three
   prefixes, or matched a prefix but the corresponding DB verify returned `null`
   (revoked/expired/unknown). Note the checks are independent sequential `if` blocks
   (not `else if`) — harmless in practice because each `verify*` function itself is
   guarded by the same prefix check (e.g. `verifyMobileSession` immediately returns
   `null` if the token doesn't start with `aeon_s1_`), so a token can only ever attempt
   one real verification, but the structure means three prefix string comparisons run
   unconditionally per request rather than short-circuiting via `else if`. INFERRED:
   negligible perf cost, purely a style/robustness observation, not a bug.

6. **Session-cookie fallback** — `auth.ts:51-56` — VERIFIED
   ```ts
   const session = await auth()
   if (!session?.user?.id) {
     return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
   }
   return { id: session.user.id, role: session.user.role || 'user' }
   ```
   - Only reached when **no** `Authorization` header is present (or it doesn't start with
     `Bearer `) — see the entry-point note above.
   - `auth` is `cache(nextAuth.auth)` from `apps/web/src/lib/auth.ts:147` (VERIFIED) — the
     NextAuth v5 session resolver, reading the session cookie set by NextAuth
     (Google / GitHub / Resend magic-link providers per `CLAUDE.md`).
   - This is the **only** path that forwards the real `session.user.role` value
     (falling back to `'user'` only if the field is falsy) rather than hardcoding it.

## Token-type comparison table (VERIFIED from code above)

| Prefix      | Verify fn                  | Storage table         | Hash    | Expiry check              | Revocation check      | Role forwarded          | Touch/last-used write         |
|-------------|-----------------------------|------------------------|---------|----------------------------|------------------------|--------------------------|--------------------------------|
| (none)      | `constantTimeCompare`       | env var, not DB        | none    | none                        | none                    | hardcoded `'admin'`      | none                            |
| `aeon_k1_`  | `verifyApiKey`               | `apiKeys`              | SHA-256 | none (non-expiring)         | `revokedAt IS NULL`     | hardcoded `'user'`       | unconditional, fire-and-forget |
| `aeon_s1_`  | `verifyMobileSession`        | `mobileSessions`       | SHA-256 | `expiresAt > now()` (90d)   | none (no revoke column) | hardcoded `'user'`       | none                            |
| `aeon_at_`  | `verifyOAuthAccessToken`     | `oauthAccessTokens`    | SHA-256 | `expiresAt < now()` check (30d) | `revokedAt IS NULL` | hardcoded `'user'`       | throttled to 1/60s             |
| n/a (cookie)| NextAuth `auth()`            | NextAuth session store | n/a     | NextAuth session TTL        | NextAuth session revoke | real `session.user.role` | n/a (NextAuth-managed)          |

## Ordering quirks & risks (recap)

- **No cross-fallback within the Bearer branch**: an invalid/expired/revoked bearer token
  never falls back to the session cookie — by design, and correct for API-client security,
  but worth noting for anyone assuming "auth() as a catch-all." VERIFIED.
- **Role is hardcoded to `'user'` for all three DB-backed token types**, while the master
  key and session-cookie paths can yield `'admin'`. INFERRED risk: no bearer-token client
  (API key, mobile app, OAuth integration) can ever act with admin role except via the
  master key — this may be intentional (principle of least privilege for tokenized
  access) but should be a deliberate decision, not an accidental side effect of the
  literal `role: 'user'` at three call sites.
- **OAuth `scope` is fetched but discarded** (`auth.ts:44-45`) — scope-based authorization
  is not enforced at this chokepoint. INFERRED: if scope-limited OAuth tokens are meant to
  restrict access (e.g. read-only agent integrations), that enforcement must happen
  elsewhere (not found in this file) or does not exist yet.
- **API keys have no expiry**, only revocation — differs from mobile sessions (time-boxed,
  no revocation column) and OAuth tokens (both time-boxed and revocable). INFERRED as an
  intentional per-token-type design difference, but it means a leaked, never-revoked
  `aeon_k1_` key is valid indefinitely.
- **`lastUsedAt` semantics are inconsistent** across the three types (always-write vs.
  never-write vs. throttled-write) — purely an observability inconsistency, not a
  security issue. INFERRED.
- **Master-key branch runs first and unconditionally** on every Bearer request (a string
  length + timing-safe compare), before any prefix check — cheap, but means every request
  pays that comparison cost even for a `aeon_k1_...` token. INFERRED: negligible
  performance concern only.

## Consumers (VERIFIED via grep)

`authenticateRequest` is imported and called by all 69 route files under
`apps/web/src/app/api/v1/**/route.ts` plus `apps/web/src/app/api/[transport]/route.ts`
(the MCP tool-call endpoint), confirming this module is the single, shared auth
chokepoint for both the REST and MCP surfaces described in `CLAUDE.md`'s
"MCP/REST parity invariant."

## VERIFIED vs INFERRED — legend recap

- **VERIFIED** statements are drawn directly from reading the cited file:line ranges.
- **INFERRED** statements are reasoned conclusions about intent, risk, or design rationale
  not literally stated in the code/comments (except where the code itself carries an
  explanatory comment, which is cited as VERIFIED-with-comment).
