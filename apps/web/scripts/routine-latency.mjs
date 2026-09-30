#!/usr/bin/env node
// Measure a Claude Code routine's API-trigger round-trip against the Kairos
// thinking queue (docs/kairos/33-thinking-routine.md §Latency).
//
// Fires the routine, then polls Aeon REST (GET /api/v1/kairos/thinking-jobs)
// until a job is claimed and then completed after the fire, printing elapsed
// seconds for fire→session, fire→first claim and fire→first submit.
//
// MANUAL ONLY — never run in tests or CI: it starts a real routine run on the
// owner's Max plan (counts against the 30/h per-routine run limit) and, if a
// job is due, the routine writes real cortex/aether memories. Only useful
// inside the night window (after archetypes ~02:30Z, before 03:13Z) when a
// job is claimable; otherwise the routine claims nothing and this times out.
//
// Env:
//   ROUTINE_ID     routine trigger id from the API-trigger modal (trig_…)
//   ROUTINE_TOKEN  routine bearer token (shown once when generated)
//   AEON_API_KEY   Aeon API key (Bearer) for the REST poll
//   AEON_APP_URL   Aeon base URL (fallback NEXT_PUBLIC_APP_URL)
//   TIMEOUT_S      optional, default 1800
//
// Endpoint + headers verified 2026-09-30 against code.claude.com/docs/en/routines
// ("Trigger a routine"): POST https://api.anthropic.com/v1/claude_code/routines/{id}/fire,
// `Authorization: Bearer <token>`, `anthropic-beta: experimental-cc-routine-2026-04-01`,
// `anthropic-version: 2023-06-01`, optional body { text }. Response:
// { type: 'routine_fire', claude_code_session_id, claude_code_session_url }.
// Research preview — the docs warn shapes may change behind a new dated beta
// header; if the fire call 4xx's, re-check the docs for a newer header.

const FIRE_BETA = 'experimental-cc-routine-2026-04-01'
const POLL_MS = 10_000

function env(name, fallback) {
  const v = process.env[name] ?? fallback
  if (!v) {
    console.error(`missing env ${name}`)
    process.exit(2)
  }
  return v
}

const routineId = env('ROUTINE_ID')
const routineToken = env('ROUTINE_TOKEN')
const aeonKey = env('AEON_API_KEY')
const appUrl = env('AEON_APP_URL', process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, '')
const timeoutMs = Number(process.env.TIMEOUT_S ?? 1800) * 1000

const secs = (from) => ((Date.now() - from) / 1000).toFixed(1)

async function listJobs() {
  const res = await fetch(`${appUrl}/api/v1/kairos/thinking-jobs?limit=50`, {
    headers: { Authorization: `Bearer ${aeonKey}` },
  })
  if (!res.ok) throw new Error(`thinking-jobs list ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return body?.data?.jobs ?? body?.jobs ?? []
}

async function main() {
  const firedAt = Date.now()
  const fire = await fetch(`https://api.anthropic.com/v1/claude_code/routines/${routineId}/fire`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${routineToken}`,
      'anthropic-beta': FIRE_BETA,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: 'latency probe — run the thinking routine as usual' }),
  })
  const fireBody = await fire.text()
  if (!fire.ok) {
    console.error(`fire failed ${fire.status}: ${fireBody}`)
    process.exit(1)
  }
  let session = ''
  try { session = JSON.parse(fireBody).claude_code_session_url ?? '' } catch { /* non-JSON body */ }
  console.log(`fired in ${secs(firedAt)}s ${session}`)

  const since = new Date(firedAt - 5_000)
  let claimSeen = false
  while (Date.now() - firedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    let jobs
    try {
      jobs = await listJobs()
    } catch (err) {
      console.error(String(err))
      continue
    }
    const claimed = jobs.find((j) => j.claimedAt && new Date(j.claimedAt) >= since)
    if (claimed && !claimSeen) {
      claimSeen = true
      console.log(`first claim after ${secs(firedAt)}s (${claimed.kind} ${claimed.externalKey})`)
    }
    const finished = jobs.find((j) => j.completedAt && new Date(j.completedAt) >= since && (j.status === 'done' || j.status === 'failed'))
    if (finished) {
      console.log(`first submit after ${secs(firedAt)}s (${finished.kind} ${finished.status}${finished.error ? `: ${finished.error}` : ''})`)
      return
    }
  }
  console.error(`timeout after ${secs(firedAt)}s — ${claimSeen ? 'claimed but never submitted' : 'no job claimed (outside the night window?)'}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
