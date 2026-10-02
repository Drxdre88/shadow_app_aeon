import { listBrainJobsSince, summariseChatLatency } from '@/lib/data/brain-status'
import { writeCronSuccessTrace } from '@/lib/kairos/cron-trace'
import type { KairosChatLatency } from '@/lib/kairos/routines/status-types'

// Daily chat-routine latency rollup (previous UTC day), written by the
// synthesis-health cron as a `chat-routine` success trace tagged
// recipe CHAT_LATENCY, so get_trace_history { recipe: 'CHAT_LATENCY' } returns
// one row a day. Idempotent per run day via writeCronSuccessTrace's externalId.

export const CHAT_LATENCY_RECIPE = 'CHAT_LATENCY'
export const CHAT_ROUTINE_CRON_NAME = 'chat-routine'

const DAY_MS = 24 * 60 * 60 * 1000

// Best-effort: never throws; returns the day's summary (null = no turns).
export async function writeChatLatencyRollup(userId: string, now: Date = new Date()): Promise<KairosChatLatency | null> {
  const dayEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const dayStart = dayEnd - DAY_MS
  const day = new Date(dayStart).toISOString().slice(0, 10)
  try {
    const rows = await listBrainJobsSince(userId, new Date(dayStart))
    const summary = summariseChatLatency(rows, now, { from: new Date(dayStart), to: new Date(dayEnd - 1) })
    const turns = summary?.turns ?? 0
    await writeCronSuccessTrace(userId, {
      cronName: CHAT_ROUTINE_CRON_NAME,
      outcome: turns > 0 ? 'ok' : 'skipped',
      ...(turns > 0 ? {} : { skipReason: 'no_turns' }),
      now,
      details: {
        recipe: CHAT_LATENCY_RECIPE,
        day,
        turns,
        routine: summary?.routine ?? 0,
        backup: summary?.backup ?? 0,
        missed: summary?.missed ?? 0,
        p50Ms: summary?.p50Ms ?? null,
        p95Ms: summary?.p95Ms ?? null,
        maxMs: summary?.maxMs ?? null,
        backupP50Ms: summary?.backupP50Ms ?? null,
        fireFailures: summary?.fireFailures ?? 0,
      },
    })
    return summary
  } catch (err) {
    console.error('[kairos:chat-latency] rollup failed', { userId, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}
