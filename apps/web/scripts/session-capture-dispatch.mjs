export const MAX_HOOK_PAYLOAD_BYTES = 16_000

function parseHookPayload(raw) {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw, 'utf8') > MAX_HOOK_PAYLOAD_BYTES) return null
  try {
    const payload = JSON.parse(raw)
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch {
    return null
  }
}

export function normalizeCodexHook(raw) {
  const payload = parseHookPayload(raw)
  return payload && typeof payload.transcript_path === 'string' ? payload : null
}

/**
 * A Codex SessionStart payload — the trigger for backfill.
 *
 * Deliberately the inverse of normalizeCodexHook: a payload carrying
 * transcript_path is an END payload and is rejected here, so the two never
 * both claim the same hook fire. Codex does not name its start event the way
 * Copilot does, so absence of a transcript is the discriminator.
 *
 * session_id may legitimately be null; the backfill treats that as "exclude
 * nothing", which receipts make safe.
 */
export function normalizeCodexStartHook(raw) {
  const payload = parseHookPayload(raw)
  if (!payload || typeof payload.transcript_path === 'string') return null

  const sessionId = payload.session_id ?? payload.sessionId
  return {
    client: 'codex',
    session_id: typeof sessionId === 'string' ? sessionId : null,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
    hook_event_name: 'SessionStart',
  }
}

export function normalizeCopilotHook(raw) {
  const input = parseHookPayload(raw)
  if (!input) return null

  const sessionId = input.sessionId ?? input.session_id
  if (typeof sessionId !== 'string') return null
  const isSessionStart = input.hook_event_name === 'SessionStart' || input.hook_event_name === 'sessionStart' ||
    input.source === 'startup' || input.source === 'resume' || input.source === 'new'

  return {
    client: 'copilot',
    session_id: sessionId,
    cwd: typeof input.cwd === 'string' ? input.cwd : null,
    hook_event_name: isSessionStart ? 'SessionStart' : 'SessionEnd',
    reason: typeof input.reason === 'string' ? input.reason : null,
  }
}

export function encodeHookPayload(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
}
