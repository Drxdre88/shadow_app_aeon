// Copilot telemetry from the session_meta record the SQLite loader writes.
export function copilotTelemetry(records) {
  const meta = records.find((r) => r?.type === 'session_meta')?.payload || {}
  const out = {}
  if (typeof meta.branch === 'string' && meta.branch) out.branch = meta.branch
  if (typeof meta.title === 'string' && meta.title.trim()) out.aiTitle = meta.title.trim()
  const u = meta.usage
  if (u && typeof u === 'object') {
    if (typeof u.model === 'string' && u.model) out.model = u.model
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens']) {
      if (Number.isFinite(u[k])) out[k] = u[k]
    }
    // Like Codex, Copilot's input_tokens includes the cached part (observed:
    // cache reads ≈ 94% of input). Report non-cached input, matching Claude.
    if (Number.isFinite(out.inputTokens) && Number.isFinite(out.cacheReadTokens)) {
      out.inputTokens = Math.max(0, out.inputTokens - out.cacheReadTokens)
    }
  }
  return out
}
