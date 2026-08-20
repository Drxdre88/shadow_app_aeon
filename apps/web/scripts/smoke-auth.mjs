#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// Auth smoke test — performs the REAL Google sign-in handshake and asserts the
// app issues its redirect to Google instead of 500-ing. This is the exact
// failure that took prod login down on 2026-06-08; run this after every deploy
// (or against a local `next start`) and it catches that class of bug in one
// shot — before users do.
//
// Usage:
//   node scripts/smoke-auth.mjs --base https://aeon.shadow-lab.ai
//   AEON_BASE_URL=https://aeon.shadow-lab.ai node scripts/smoke-auth.mjs
// Exit 0 = healthy, non-zero = login is broken.
// ─────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
function flag(name, def) {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const BASE = flag('--base', process.env.AEON_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '')

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
function pass(msg) {
  console.log(`✓ ${msg}`)
}

async function main() {
  console.log(`Auth smoke test → ${BASE}\n`)

  // 1. Providers endpoint must list Google.
  let provRes
  try {
    provRes = await fetch(`${BASE}/api/auth/providers`)
  } catch (err) {
    fail(`cannot reach ${BASE} (${err instanceof Error ? err.message : err})`)
  }
  if (!provRes.ok) fail(`GET /api/auth/providers → ${provRes.status}`)
  const providers = await provRes.json().catch(() => ({}))
  if (!providers.google) {
    // Preview deployments don't carry the Google OAuth env vars, so the
    // provider is legitimately absent there — the sign-in POST paths can only
    // be exercised where the provider exists. SMOKE_ALLOW_MISSING_PROVIDER=1
    // (set by the auth-smoke workflow for non-production environments)
    // downgrades this to a liveness check: the handlers answered with
    // well-formed JSON, which is exactly what the "No response is returned"
    // 500 class breaks. Production stays strict.
    if (process.env.SMOKE_ALLOW_MISSING_PROVIDER === '1') {
      const csrfProbe = await fetch(`${BASE}/api/auth/csrf`)
      if (!csrfProbe.ok) fail(`GET /api/auth/csrf → ${csrfProbe.status}`)
      const { csrfToken } = await csrfProbe.json().catch(() => ({}))
      if (!csrfToken) fail('csrf response is not well-formed JSON')
      pass('auth handlers respond (providers + csrf JSON) — google absent, sign-in paths skipped on this environment')
      console.log('\nAuth smoke: LIVENESS-ONLY PASS (no google provider in this environment)')
      process.exit(0)
    }
    fail('providers response does not list "google"')
  }
  pass('providers lists google')

  // 2. CSRF token + cookie.
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  if (!csrfRes.ok) fail(`GET /api/auth/csrf → ${csrfRes.status}`)
  const { csrfToken } = await csrfRes.json().catch(() => ({}))
  if (!csrfToken) fail('no csrfToken returned')
  const cookie =
    (typeof csrfRes.headers.getSetCookie === 'function' ? csrfRes.headers.getSetCookie() : [])
      .join('; ') || csrfRes.headers.get('set-cookie') || ''
  pass('csrf token acquired')

  // 3. The regression: sign-in POST must 302 to Google, not 500.
  const body = new URLSearchParams({ csrfToken, callbackUrl: `${BASE}/dashboard` })
  const signinRes = await fetch(`${BASE}/api/auth/signin/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body,
    redirect: 'manual',
  })
  if (signinRes.status !== 302) {
    fail(`signin POST → ${signinRes.status} (expected 302). LOGIN IS BROKEN.`)
  }
  const loc = signinRes.headers.get('location') || ''
  if (!loc.startsWith('https://accounts.google.com/')) {
    fail(`signin redirected to "${loc.slice(0, 80)}" (expected accounts.google.com)`)
  }
  pass(`signin → 302 → ${loc.slice(0, 56)}…`)

  // 4. The 2026-08-17 regression: the BROWSER sign-in path. next-auth/react's
  // signIn()/signOut() always send X-Auth-Return-Redirect, which makes
  // @auth/core return `Response.json({url})` instead of a 302 — and on
  // Next 16.1.x Turbopack production builds that Response was built from a
  // differently-bundled class the route runtime didn't recognise, so EVERY
  // UI login/logout button 500'd while this smoke test (302 path) stayed
  // green. Assert the JSON path explicitly so that can never ship again.
  const csrfRes2 = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken: csrfToken2 } = await csrfRes2.json().catch(() => ({}))
  const cookie2 =
    (typeof csrfRes2.headers.getSetCookie === 'function' ? csrfRes2.headers.getSetCookie() : [])
      .join('; ') || csrfRes2.headers.get('set-cookie') || ''
  const browserRes = await fetch(`${BASE}/api/auth/signin/google`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookie2,
      'X-Auth-Return-Redirect': '1',
    },
    body: new URLSearchParams({ csrfToken: csrfToken2, callbackUrl: `${BASE}/dashboard` }),
    redirect: 'manual',
  })
  if (browserRes.status !== 200) {
    fail(`browser-path signin POST → ${browserRes.status} (expected 200 JSON). UI LOGIN/LOGOUT IS BROKEN.`)
  }
  const browserData = await browserRes.json().catch(() => ({}))
  if (!String(browserData.url || '').startsWith('https://accounts.google.com/')) {
    fail(`browser-path signin returned url "${String(browserData.url).slice(0, 80)}" (expected accounts.google.com)`)
  }
  pass(`browser-path signin → 200 {url: ${String(browserData.url).slice(0, 40)}…}`)

  console.log(`\nAuth smoke PASSED against ${BASE}`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
