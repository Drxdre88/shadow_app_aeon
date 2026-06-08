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
  if (!providers.google) fail('providers response does not list "google"')
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

  console.log(`\nAuth smoke PASSED against ${BASE}`)
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
