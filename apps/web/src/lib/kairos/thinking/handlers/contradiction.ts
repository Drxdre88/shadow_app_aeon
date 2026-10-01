import { z } from 'zod'
import { findDominionsByUser } from '@/lib/data/dominions'
import { findSimilarBeliefs } from '@/lib/data/memories'
import { listJobs } from '@/lib/data/thinking-jobs'
import {
  CONTRADICTION_MAX_OUTPUT_TOKENS,
  alreadyRanToday,
  contradictionJobKey,
  fetchProbes,
  stageContradictionProposals,
  type JudgedProbe,
} from '@/lib/kairos/contradiction'
import {
  CONTRADICTION_BATCH_SYSTEM_PROMPT,
  buildContradictionBatchUserPrompt,
  buildContradictionUserPrompt,
  contradictionBatchOutSchema,
  extractJsonBlock,
  filterGroundedBatchFindings,
  type ContradictionBatchItem,
  type ContradictionCandidate,
  type GroundedProbeFindings,
} from '@/lib/kairos/contradiction-prompt'
import { embeddingsEnabled } from '@/lib/kairos/embeddings'
import { todayIso } from '@/lib/kairos/_prompt-utils'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { CONTRADICTION_WINDOW_UTC, minutesLeftInWindow, utcDay, utcDayStart } from '../deadlines'
import { errorReason } from './_errors'

// Contradiction scan on the thinking queue: one job per active Dominion per
// UTC day batching every recent probe belief that has neighbours (the 05:00
// contradiction-scan cron makes one model call per probe). The answer is
// parsed strictly, each finding grounded against ITS probe's candidates, and
// staged through the cron's own stageContradictionProposals (same winner /
// loser rows, same pair dedup) — the cron's isJobDone guard then skips the
// Dominion, including a clean scan that wrote nothing. Fallback = the cron.

// Bound on the batch prompt: probes come newest first, so a heavy Dominion
// drops its oldest probes (still inside the 7-day window for tomorrow).
export const CONTRADICTION_BATCH_MAX_CHARS = 100_000

const contextSchema = z.object({
  dominionId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  probes: z.array(z.object({
    probeId: z.string().min(1),
    title: z.string(),
    candidates: z.array(z.object({ id: z.string().min(1), title: z.string() })),
  })),
})
type ContradictionJobContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): ContradictionJobContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function gatherBatch(userId: string, dominionId: string): Promise<ContradictionBatchItem[]> {
  const items: ContradictionBatchItem[] = []
  let chars = 0
  for (const probe of await fetchProbes(userId, dominionId)) {
    const candidates = await findSimilarBeliefs(probe.id, userId, { dominionId })
    if (candidates.length === 0) continue
    const item = { probe, candidates: candidates as ContradictionCandidate[] }
    const size = buildContradictionUserPrompt(item.probe, item.candidates).length
    if (items.length > 0 && chars + size > CONTRADICTION_BATCH_MAX_CHARS) break
    items.push(item)
    chars += size
  }
  return items
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const deadlineMinutes = minutesLeftInWindow(now, CONTRADICTION_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []
  // Candidate retrieval is vector-only (same guard as the cron).
  if (!embeddingsEnabled()) return []

  const day = utcDay(now)
  const active = (await findDominionsByUser(userId)).filter((d) => !d.archivedAt)
  if (active.length === 0) return []
  const existing = new Set(
    (await listJobs(userId, { kind: 'contradiction', since: utcDayStart(now), limit: 200 })).map((j) => j.externalKey),
  )
  // One planning pass per day: probes and their neighbours barely move inside
  // the window, and the probe search (up to 25 vector queries per Dominion)
  // must not re-run on every claim for Dominions that yielded no batch.
  if (existing.size > 0) return []

  const specs: ThinkingJobSpec[] = []
  for (const dom of active) {
    const externalKey = contradictionJobKey(dom.id, day)
    if (existing.has(externalKey)) continue
    if (await alreadyRanToday(userId, dom.id)) continue

    const items = await gatherBatch(userId, dom.id)
    if (items.length === 0) continue

    const validIds = new Set(items.flatMap((i) => [i.probe.id, ...i.candidates.map((c) => c.id)]))
    specs.push({
      kind: 'contradiction',
      dominionId: dom.id,
      externalKey,
      deadlineMinutes,
      input: {
        system: CONTRADICTION_BATCH_SYSTEM_PROMPT,
        prompt: buildContradictionBatchUserPrompt(items),
        validMemoryIds: [...validIds],
        maxOutputTokens: CONTRADICTION_MAX_OUTPUT_TOKENS,
        context: {
          dominionId: dom.id,
          date: day,
          probes: items.map((i) => ({
            probeId: i.probe.id,
            title: i.probe.title,
            candidates: i.candidates.map((c) => ({ id: c.id, title: c.title })),
          })),
        } satisfies ContradictionJobContext,
      },
    })
  }
  return specs
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const c = readContext(job)
  if (!c) return { ok: false, reason: 'bad_job: contradiction job has no dominion/date/probe context' }
  if (c.date !== todayIso()) return { ok: false, reason: `stale_job: planned for ${c.date}` }
  if (await alreadyRanToday(job.userId, c.dominionId)) {
    return { ok: false, reason: 'already_ran: a contradiction scan for this Dominion already ran today' }
  }

  let grounded: GroundedProbeFindings[]
  try {
    const candidateIdsByProbe = new Map(c.probes.map((p) => [p.probeId, new Set(p.candidates.map((x) => x.id))]))
    grounded = filterGroundedBatchFindings(contradictionBatchOutSchema.parse(extractJsonBlock(text)), candidateIdsByProbe)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }

  const findingsByProbe = new Map(grounded.map((g) => [g.probeId, g.findings]))
  const judged: JudgedProbe[] = c.probes.map((p) => ({
    probe: { id: p.probeId, title: p.title },
    candidates: p.candidates,
    findings: findingsByProbe.get(p.probeId) ?? [],
  }))
  const memoryIds = await stageContradictionProposals(
    job.userId,
    c.dominionId,
    `contradiction:${c.dominionId}:${c.date}`,
    judged,
    { extraMetadata: { thinkingJobId: job.id, answeredBy } },
  )
  return { ok: true, memoryIds }
}

export const contradictionHandler: ThinkingJobHandler = {
  kind: 'contradiction',
  plan,
  apply,
  // The 05:00 contradiction-scan cron is the fallback; the sweep only expires.
  fallback: async () => ({ ok: false, reason: 'deferred to the 05:00 UTC contradiction-scan cron' }),
}
