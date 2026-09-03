#!/usr/bin/env node
// Kairos Phase 3 (D17) — Claude Code session hook.
//
// Installed in ~/.claude/settings.json as a PostToolUse + Stop hook. On every
// hook fire, reads the event payload from stdin, picks out the relevant
// fields, and POSTs to the Aeon /api/v1/sessions/{id}/events endpoint.
//
// Hook only fires when KAIROS_SESSION_ID is set in the env — which the
// kairos-worker injects when it spawns the CLI. For sessions started
// outside Kairos (the operator running `claude` themselves) the env is
// absent and the hook exits 0 immediately, so it has no effect.
//
// Hard rule: never block the user session. Any failure exits 0 silently.

import { argv, env, exit, stdin } from 'node:process'

const SESSION_ID    = env.KAIROS_SESSION_ID
const CALLBACK_URL  = env.KAIROS_CALLBACK_URL
const CALLBACK_TOKEN = env.KAIROS_CALLBACK_TOKEN

if (!SESSION_ID || !CALLBACK_URL || !CALLBACK_TOKEN) {
  exit(0)
}

// Hook name is passed as the first arg — used to differentiate the kind of
// event we're recording.
const hookName = argv[2] ?? 'unknown'

function mapHookToKind(name) {
  switch (name) {
    case 'PostToolUse':  return 'tool_result'
    case 'PreToolUse':   return 'tool_use'
    case 'Stop':         return 'stop'
    case 'SubagentStop': return 'stop'
    case 'UserPromptSubmit': return 'message'
    default:             return 'status'
  }
}

// Deep-clamp every string so tool_response of a large Read/Bash can't push
// the serialized payload over the server's 32K-char cap. NULs stripped —
// Postgres jsonb refuses them.
const STRING_CLAMP = 8000
const DEPTH_CAP = 6
const BREADTH_CAP = 100
// Per-string clamping alone does not bound the whole body (many strings, many
// keys), so the serialized body is measured after clamping and replaced
// wholesale when it is still over the server's limit.
const BODY_CAP = 30_000

function clampStrings(value, depth = 0) {
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    const clean = value.replace(/\u0000/g, '')
    if (clean.length <= STRING_CLAMP) return clean
    let cut = clean.slice(0, STRING_CLAMP)
    // The cut can land between the halves of a surrogate pair; a lone high
    // half serializes to an unpaired escape jsonb refuses.
    const last = cut.charCodeAt(cut.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
    return `${cut}…`
  }
  if (value === null || typeof value !== 'object') return value
  // Past the depth cap the subtree used to be returned untouched, which handed
  // back the unbounded value and defeated the clamp it exists to enforce.
  if (depth >= DEPTH_CAP) return '[depth capped]'
  if (Array.isArray(value)) {
    const kept = value.slice(0, BREADTH_CAP).map((v) => clampStrings(v, depth + 1))
    if (value.length > BREADTH_CAP) kept.push(`[+${value.length - BREADTH_CAP} items dropped]`)
    return kept
  }
  // Object breadth was unbounded while arrays were capped — a payload with
  // thousands of small keys sailed past the clamp.
  const entries = Object.entries(value)
  const out = {}
  for (const [k, v] of entries.slice(0, BREADTH_CAP)) out[k] = clampStrings(v, depth + 1)
  if (entries.length > BREADTH_CAP) out.__droppedKeys = entries.length - BREADTH_CAP
  return out
}

function safeStringify(body) {
  try {
    return JSON.stringify(body)
  } catch {
    return null
  }
}

async function readStdin() {
  return new Promise((resolveBody) => {
    const chunks = []
    stdin.on('data', (c) => chunks.push(c))
    stdin.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')))
    stdin.on('error', () => resolveBody(''))
    setTimeout(() => resolveBody(''), 1500)
  })
}

async function main() {
  const raw = await readStdin()
  let payload = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { raw: raw.slice(0, 8000) }
  }

  const kind = mapHookToKind(hookName)
  const rawToolName =
    typeof payload.tool_name === 'string'
      ? payload.tool_name
      : typeof payload.tool === 'string'
      ? payload.tool
      : null
  // Server contract: toolName column caps at 80, event payloads at 32K chars
  // serialized — an oversized post 400s and this hook fails silently, so
  // clamp at the producer.
  const toolName = rawToolName ? rawToolName.slice(0, 80) : null

  const body = {
    kind,
    toolName,
    payload: clampStrings({ hook: hookName, ...payload }),
  }

  // Last line of defence: an oversized post 400s and the timeline loses the
  // event entirely, so a body that is still too big degrades to a marker.
  let serialized = safeStringify(body)
  if (serialized === null) exit(0)
  if (serialized.length > BODY_CAP) {
    body.payload = { hook: hookName, truncated: true, kind, size: serialized.length }
    serialized = safeStringify(body)
    if (serialized === null) exit(0)
  }

  try {
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 5000)
    await fetch(`${CALLBACK_URL.replace(/\/$/, '')}/api/v1/sessions/${SESSION_ID}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CALLBACK_TOKEN}`,
      },
      body: serialized,
      signal: ac.signal,
    })
    clearTimeout(timeout)
  } catch {
    // never block — silent fail is intentional
  }
  exit(0)
}

main().catch(() => exit(0))
