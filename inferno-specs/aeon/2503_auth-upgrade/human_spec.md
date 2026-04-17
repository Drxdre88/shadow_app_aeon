# Auth Upgrade Decision — Aeon Project Management

**Date:** 2503 (25 March 2026)
**Status:** Proposed
**Scope:** Authentication and registration flow

---

## Current State

**Providers configured** (conditional on env vars):
- Google OAuth (primary, only one rendered in LoginForm UI)
- GitHub OAuth (configured in auth.ts, not surfaced in UI)
- Resend magic link (configured in auth.ts, not surfaced in UI)

**Access control:** `ALLOWED_EMAILS` env var — comma-separated whitelist checked in the `signIn` callback. Empty list = allow all. This is the only gate; there is no registration form.

**Session strategy:** Database sessions via DrizzleAdapter with 30-day `maxAge`. Session token read from `authjs.session-token` / `__Secure-authjs.session-token` cookies in middleware.

**API key auth:** Bearer tokens with `aeon_k1_` prefix. SHA-256 hashed, stored in `api_keys` table. Verified with timing-safe comparison. Separate master key path via `AEON_API_KEY` env var for admin access.

**Role system:** `role` column on `users` table (default `user`). Auto-promoted to `admin` if email matches `ADMIN_EMAILS` env var on account creation.

**Key files:**
- `src/lib/auth.ts` — NextAuth config, providers, callbacks
- `src/lib/api/auth.ts` — API middleware, Bearer token verification
- `src/lib/db/schema.ts` — users, accounts, sessions, verificationTokens, apiKeys tables
- `src/app/api/auth/[...nextauth]/route.ts` — Auth route handler
- `src/app/login/LoginForm.tsx` — Login UI (Google button + demo link only)
- `src/middleware.ts` — Route protection, cookie-based session check

**Gaps identified:**
- GitHub and Resend providers are wired but invisible in the UI
- No self-registration flow — users must be pre-approved via env var
- No 2FA of any kind
- No password-based auth
- `users` table has no `passwordHash` or `totpSecret` columns

---

## Option A: Email + Password with TOTP 2FA

**Approach:** Add NextAuth `CredentialsProvider`. New registration page with email/password. TOTP 2FA setup in user settings (QR code for Google Authenticator / Authy). Remove `ALLOWED_EMAILS` gate for beta. Keep Google and GitHub OAuth as convenience options.

**Schema changes:** Add `passwordHash` (varchar) and `totpSecret` (varchar, nullable) to `users` table. Add `totpEnabled` (boolean, default false).

| Enables | Costs |
|---------|-------|
| Self-registration without OAuth dependency | Credentials provider forces JWT strategy (no database sessions) or custom session handling |
| Familiar email/password flow for all users | Password reset flow must be built (Resend integration) |
| TOTP adds strong second factor | bcrypt dependency, TOTP library (otpauth/speakeasy) |
| Works offline / behind corporate firewalls blocking OAuth | Password storage liability — must handle hashing, rotation, breach response |

**Forecloses:** Nothing permanent. OAuth providers remain. Can add passkeys later as an upgrade path.

---

## Option B: Passkeys (WebAuthn)

**Approach:** Add `@simplewebauthn/server` + `@simplewebauthn/browser`. New `credentials` table for WebAuthn credential storage. Registration prompts device biometric or security key. No passwords stored.

| Enables | Costs |
|---------|-------|
| Phishing-resistant by design | Browser support gaps (older Safari, some mobile browsers) |
| No password to leak or reset | User unfamiliarity — "what is a passkey?" friction |
| Built-in 2FA (biometric = something you are) | Recovery is hard — lost device means lost access without backup flow |
| Modern, forward-looking standard | More complex implementation: challenge generation, attestation verification |

**Forecloses:** Users on unsupported browsers are locked out unless a fallback (OAuth or password) exists, which defeats the simplicity argument.

---

## Option C: Keep Current + Open Registration

**Approach:** Surface the existing GitHub and Resend providers in the LoginForm UI. Remove `ALLOWED_EMAILS` gate. No new auth mechanisms.

| Enables | Costs |
|---------|-------|
| Minimal code change | No 2FA — weaker security posture |
| Magic link via Resend covers passwordless | Dependent on third-party OAuth availability |
| Fastest to ship | No offline/corporate firewall support |

---

## Decision Matrix

| Factor | A: Email+Pass+TOTP | B: Passkeys | C: Current+Open |
|---|---|---|---|
| User familiarity | High | Low | Medium |
| Security ceiling | High (password + TOTP) | Highest (phishing-proof) | Low (single factor) |
| Implementation effort | Medium (3-5 days) | High (5-8 days) | Low (1 day) |
| Beta readiness | Strong | Risky (support gaps) | Adequate |
| Recovery flow | Standard (email reset) | Complex (backup codes) | Trivial (re-OAuth) |
| Offline/firewall use | Yes | Yes | No |

---

## Recommendation

**Option A (Email + Password + TOTP)** for closed beta launch.

Rationale: It is the only option that simultaneously supports self-registration, works behind corporate firewalls, and provides 2FA — all without alienating users unfamiliar with passkeys. Passkeys (Option B) are a strong future addition once the user base is established and browser support matures, but introducing them as the primary flow during beta adds unnecessary friction and support burden. Option C is too thin for any deployment beyond personal use.

Keep Google and GitHub OAuth as convenience sign-in. Make TOTP optional during beta, mandatory before GA.

---

## Migration Path

1. **Schema migration:** Add `passwordHash`, `totpSecret`, `totpEnabled` columns to `users` table. Non-destructive — all nullable/defaulted.
2. **Add Credentials provider** to `auth.ts` alongside existing OAuth providers. Existing sessions and accounts are untouched.
3. **Build registration page** at `/register`. Wire to create user with hashed password.
4. **Update LoginForm** to show email/password fields, Google button, GitHub button. Keep demo link.
5. **Remove `ALLOWED_EMAILS`** gate from `signIn` callback (or make it optional via env flag for staged rollout).
6. **Add TOTP setup** in user settings (Phase 2 — not required for initial launch).
7. **Existing OAuth users** continue working with zero changes. They can optionally set a password later.

---

## Files That Would Change

| File | Change |
|---|---|
| `src/lib/db/schema.ts` | Add password/TOTP columns to users table |
| `src/lib/auth.ts` | Add CredentialsProvider, adjust session handling |
| `src/app/login/LoginForm.tsx` | Email/password form, GitHub button |
| `src/app/login/page.tsx` | Minor layout adjustment |
| `src/middleware.ts` | Add `/register` to PUBLIC_PATHS |
| `src/app/register/page.tsx` | **New** — Registration form |
| `src/app/api/auth/register/route.ts` | **New** — Registration API endpoint |
| `src/app/settings/*` | TOTP setup UI (Phase 2) |
| `drizzle/migrations/*` | **New** — Schema migration for password/TOTP columns |
