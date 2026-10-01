import { findDominionsByUser } from '@/lib/data/dominions'
import { listTodaysAdvisories } from '@/lib/data/memories'
import { listJobs } from '@/lib/data/thinking-jobs'
import { persistRecipeOutput, prepareRecipeContext } from '@/lib/kairos/dispatch'
import { createConscienceLoader } from '@/lib/kairos/conscience-context'
import { briefOutput, buildBriefRequest, type BriefGroundingFlags } from '@/lib/kairos/recipes/brief'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { BRIEF_WINDOW_UTC, minutesLeftInWindow, utcDay, utcDayStart } from '../deadlines'

// Morning brief on the thinking queue: one job per active Dominion per UTC
// day, with exactly the system/user prompt the 06:15 briefer cron's BRIEF
// recipe would send. The answer is the brief itself (plain markdown), stored
// through the dispatcher's own write path (persistRecipeOutput) with the
// recipe's externalId — so the cron's runRecipe short-circuits to 'existing'
// and the daily message reads it like any other brief. Fallback = the 06:15
// briefer cron itself; the sweep only marks the job expired.

export const briefJobKey = (dominionId: string, day: string) => `brief:${dominionId}:${day}`

const ROUTINE_MODEL = 'claude-max-routine'

interface BriefJobContext {
  dominionId: string
  dominionName: string
  date: string
  grounding: BriefGroundingFlags
}

function readContext(job: ThinkingJobRow): BriefJobContext | null {
  const c = job.input?.context as Partial<BriefJobContext> | undefined
  if (!c || typeof c.dominionId !== 'string' || typeof c.date !== 'string' || typeof c.dominionName !== 'string') return null
  const g = c.grounding
  return {
    dominionId: c.dominionId,
    dominionName: c.dominionName,
    date: c.date,
    grounding: { cortex: Boolean(g?.cortex), aether: Boolean(g?.aether), conscience: Boolean(g?.conscience) },
  }
}

// The system prompt asks for bare markdown; tolerate one wrapping fence.
function unfence(text: string): string {
  const m = text.match(/^```[\w-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```$/)
  return (m ? m[1] : text).trim()
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesLeftInWindow(now, BRIEF_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []

  const day = utcDay(now)
  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt)
  if (active.length === 0) return []
  const existing = new Set(
    (await listJobs(userId, { kind: 'brief', since: utcDayStart(now), limit: 200 })).map((j) => j.externalKey),
  )
  const briefed = new Set((await listTodaysAdvisories(userId, day)).map((a) => a.dominionId))

  // One constitution read per user across all their Dominion briefs (as the cron).
  const conscience = createConscienceLoader()
  const specs: ThinkingJobSpec[] = []
  for (const dom of active) {
    const externalKey = briefJobKey(dom.id, day)
    if (existing.has(externalKey) || briefed.has(dom.id)) continue

    const ctx = await prepareRecipeContext('BRIEF', { userId, dominionId: dom.id, surface: 'byok', conscience })
    // The cron records this as skipped ('not found').
    if (!ctx.retrieval.bundle) continue
    const req = buildBriefRequest(ctx, day)

    specs.push({
      kind: 'brief',
      dominionId: dom.id,
      externalKey,
      deadlineMinutes,
      input: {
        system: req.system,
        prompt: req.prompt,
        maxOutputTokens: 1200,
        context: {
          dominionId: dom.id,
          dominionName: req.dominionName,
          date: day,
          grounding: req.grounding,
        } satisfies BriefJobContext,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: brief job has no dominion/date context' }
  if (c.date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${c.date}` }

  const body = unfence(text.trim())
  if (!body) return { ok: false, reason: 'parse_failed: empty brief' }
  if (!/^##\s+\S/m.test(body)) return { ok: false, reason: 'parse_failed: no ## sections (expected the four-section brief)' }

  const output = briefOutput({
    text: body,
    date: c.date,
    dominionName: c.dominionName,
    dominionId: c.dominionId,
    model: ROUTINE_MODEL,
    grounding: c.grounding,
    traceMeta: { answeredBy, thinkingJobId: job.id },
  })
  const durationMs = job.claimedAt ? Date.now() - job.claimedAt.getTime() : 0
  const run = await persistRecipeOutput('BRIEF', { userId: job.userId, dominionId: c.dominionId }, output, durationMs)
  if (run.status === 'existing') {
    return { ok: false, reason: 'already_ran: a brief for this Dominion already exists today' }
  }
  return { ok: true, memoryIds: [run.memoryId] }
}

export const briefHandler: ThinkingJobHandler = {
  kind: 'brief',
  plan,
  apply,
  // The 06:15 briefer cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 06:15 UTC briefer cron' }),
}
