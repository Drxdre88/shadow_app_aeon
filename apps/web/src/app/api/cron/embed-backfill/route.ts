import { NextRequest, NextResponse } from 'next/server'
import { backfillEmbeddings } from '@/lib/data/memories'
import { embeddingsEnabled, activeEmbeddingModel } from '@/lib/kairos/embeddings'

// ─────────────────────────────────────────────────────────────────────────
// Brain Phase 4 (P2) — embedding backfill.
//
// Embeds memories that have no vector yet (or whose vector came from a model
// other than the active provider). Idempotent + incremental: each call embeds
// up to `limit` rows and reports how many remain, so it can be looped until
// `remaining` reaches 0. Safe no-op when no embedding provider is configured.
//
// Auth + cron pattern mirrors apps/web/src/app/api/cron/memory-compaction.
// Run manually:  curl -H "authorization: Bearer $CRON_SECRET" \
//                  ".../api/cron/embed-backfill?limit=200"
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!embeddingsEnabled()) {
    return NextResponse.json(
      { error: 'embeddings_disabled', note: 'Set VOYAGE_API_KEY or OPENAI_API_KEY to enable.' },
      { status: 200 },
    )
  }

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? 200)
  const startedAt = new Date().toISOString()
  try {
    const result = await backfillEmbeddings({ limit })
    return NextResponse.json({
      startedAt,
      finishedAt: new Date().toISOString(),
      model: activeEmbeddingModel(),
      ...result,
    })
  } catch (err) {
    return NextResponse.json(
      { startedAt, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
