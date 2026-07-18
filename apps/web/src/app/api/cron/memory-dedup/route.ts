import { jsonResponse } from '@/lib/api/response'
import { NextRequest, NextResponse } from 'next/server'
import { dedupMemories } from '@/lib/data/memories'
import { embeddingsEnabled } from '@/lib/kairos/embeddings'

// ─────────────────────────────────────────────────────────────────────────
// Consolidation — memory dedup cron.
//
// Supersedes near-duplicate machine-generated memories against a canonical
// (stamp, never delete). Needs embeddings (the dedup signal is cosine
// distance), so it's a safe no-op when no provider is configured. Idempotent:
// already-superseded rows are excluded from the self-join, so re-runs converge.
//
// Auth + cron pattern mirror apps/web/src/app/api/cron/embed-backfill.
// Manual:  curl -H "authorization: Bearer $CRON_SECRET" \
//            ".../api/cron/memory-dedup?dryRun=1"
// ─────────────────────────────────────────────────────────────────────────

export const maxDuration = 300

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return jsonResponse({ error: 'unauthorized' }, { status: 401 })
  }
  if (!embeddingsEnabled()) {
    return jsonResponse(
      { error: 'embeddings_disabled', note: 'Set VOYAGE_API_KEY or OPENAI_API_KEY to enable.' },
      { status: 200 },
    )
  }

  const params = new URL(req.url).searchParams
  const dryRun = params.get('dryRun') === '1'
  const thresholdRaw = Number(params.get('threshold'))
  const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 && thresholdRaw <= 1 ? thresholdRaw : undefined

  const startedAt = new Date().toISOString()
  try {
    const result = await dedupMemories({ dryRun, threshold })
    return jsonResponse({ startedAt, finishedAt: new Date().toISOString(), ...result })
  } catch (err) {
    return jsonResponse(
      { startedAt, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
