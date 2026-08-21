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
function clampStrings(value, depth = 0) {
  if (typeof value === 'string') {
    // eslint-disable-next-line no-control-regex
    const clean = value.replace(/\u0000/g, '')
    return clean.length > STRING_CLAMP ? `${clean.slice(0, STRING_CLAMP)}…` : clean
  }
  if (depth >= 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => clampStrings(v, depth + 1))
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = clampStrings(v, depth + 1)
  return out
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

  try {
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 5000)
    await fetch(`${CALLBACK_URL.replace(/\/$/, '')}/api/v1/sessions/${SESSION_ID}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CALLBACK_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    clearTimeout(timeout)
  } catch {
    // never block — silent fail is intentional
  }
  exit(0)
}

main().catch(() => exit(0))
