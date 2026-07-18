// Kairos reliability (C3) — startup guard. Warns loudly at boot if no
// embedding provider is configured so a missing VOYAGE_API_KEY/OPENAI_API_KEY
// shows up in the deploy logs instead of silently degrading hybrid retrieval
// to FTS-only. Never throws — embeddings-disabled is a supported, graceful
// mode, not a fatal error.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Repair `Response.json` (2026-07-18): Next's node server swaps
  // `globalThis.Response` for a lazy wrapper but leaves undici's `json` static
  // on it, so `Response.json()` returns a foreign-realm instance that fails the
  // route module's `instanceof Response` check → "No response is returned from
  // route handler" empty 500s. Rebind the static to construct through the
  // active global class so every caller stays realm-consistent. Route handlers
  // should still prefer `jsonResponse` from '@/lib/api/response'; this guard
  // covers stragglers and future code.
  const GlobalResponse = globalThis.Response
  if (typeof GlobalResponse === 'function') {
    const realmSafeJson = (data: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers)
      if (!headers.has('content-type')) headers.set('content-type', 'application/json')
      return new GlobalResponse(JSON.stringify(data), { ...init, headers })
    }
    try {
      Object.defineProperty(GlobalResponse, 'json', { value: realmSafeJson, configurable: true, writable: true })
    } catch {
      // Non-configurable in some runtime — leave as-is; helpers avoid the static anyway.
    }
  }

  const { embeddingsEnabled } = await import('@/lib/kairos/embeddings')
  if (!embeddingsEnabled()) {
    console.warn(
      '[kairos:instrumentation] No embedding provider configured (VOYAGE_API_KEY / OPENAI_API_KEY unset) — ' +
        'hybrid retrieval will degrade to full-text search only.',
    )
  }
}
