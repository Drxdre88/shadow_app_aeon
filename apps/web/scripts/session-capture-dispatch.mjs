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
