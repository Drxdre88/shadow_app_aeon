// Kairos reliability (C3) — startup guard. Warns loudly at boot if no
// embedding provider is configured so a missing VOYAGE_API_KEY/OPENAI_API_KEY
// shows up in the deploy logs instead of silently degrading hybrid retrieval
// to FTS-only. Never throws — embeddings-disabled is a supported, graceful
// mode, not a fatal error.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { embeddingsEnabled } = await import('@/lib/kairos/embeddings')
  if (!embeddingsEnabled()) {
    console.warn(
      '[kairos:instrumentation] No embedding provider configured (VOYAGE_API_KEY / OPENAI_API_KEY unset) — ' +
        'hybrid retrieval will degrade to full-text search only.',
    )
  }
}
