import { z } from 'zod'
import { listBeliefs } from '@/lib/data/beliefs'
import { findDriftObservation, insertDriftObservation } from '@/lib/data/constitution-drift'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { alreadyRanToday as aetherRanToday } from '@/lib/kairos/aether'
import { activeEmbeddingModel, embedTexts } from '@/lib/kairos/embeddings'
import { getLiveConstitution } from '@/lib/kairos/constitution/amendment'
import {
  compareToBaseline,
  isPackedVector,
  packVector,
  unpackVector,
  type DriftComparison,
} from '@/lib/kairos/constitution/drift'
import { DRIFT_PROBE_IDS, findDriftProbe } from '@/lib/kairos/constitution/probes'
import {
  DRIFT_MAX_OUTPUT_TOKENS,
  DRIFT_PROBE_SYSTEM_PROMPT,
  buildDriftProbePrompt,
  parseDriftAnswers,
  type DriftBelief,
  type ProbeAnswer,
} from '@/lib/kairos/constitution/prompts'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { deadlineOn, utcDay } from '../deadlines'
import { askPaidAndParse } from '../paid-fallback'
import { errorReason } from './_errors'

// Nightly drift probe (docs/kairos/34 §2). plan: once per UTC day, only when a
// live constitution exists, and only once today's aether exists or after
// 03:30Z — ONE job answering every probe from the constitution + held beliefs.
// apply: strict parse, embed the answers; the first run for a constitution
// version (per embedding model — vectors from different models are not
// comparable) pins the baseline, every later night stores a drift_run with
// per-probe cosine vs the baseline and the §2 alert. fallback: paid heavy call.

export const DRIFT_PROBE_KIND = 'drift_probe' as const
export const DRIFT_JOB_DEADLINE_MINUTES = 120
export const DRIFT_NOT_BEFORE_UTC = { hour: 3, minute: 30 }
export const DRIFT_BELIEF_LIMIT = 20

export const driftJobKey = (day: string) => `drift_probe:${day}`
export const driftRunKey = (day: string) => `drift_run:${day}`
export const driftBaselineKey = (constitutionId: string, model: string) => `drift_baseline:${constitutionId}:${model}`

const contextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  constitutionId: z.string().min(1),
  version: z.number().int().min(1),
})

type DriftJobContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): DriftJobContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

export async function planDriftProbe(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const day = utcDay(now)
  const key = driftJobKey(day)
  if (await hasJobWithKeyLike(userId, DRIFT_PROBE_KIND, key)) return []

  const live = await getLiveConstitution(userId)
  if (!live) return []

  const afterCutoff = now.getTime() >= deadlineOn(now, DRIFT_NOT_BEFORE_UTC).getTime()
  if (!afterCutoff && !(await aetherRanToday(userId))) return []

  // Held beliefs of either mind, weightiest first.
  const beliefs: DriftBelief[] = (await listBeliefs(userId, { status: 'held', rank: 'standing', limit: DRIFT_BELIEF_LIMIT }))
    .map((b) => ({ mind: b.mind, domain: b.domain, claim: b.claim }))

  const context: DriftJobContext = { date: day, constitutionId: live.id, version: live.version }
  return [{
    kind: DRIFT_PROBE_KIND,
    dominionId: null,
    externalKey: key,
    deadlineMinutes: DRIFT_JOB_DEADLINE_MINUTES,
    input: {
      system: DRIFT_PROBE_SYSTEM_PROMPT,
      prompt: buildDriftProbePrompt({ version: live.version, principles: live.principles, beliefs }),
      validMemoryIds: [],
      context,
      maxOutputTokens: DRIFT_MAX_OUTPUT_TOKENS,
    },
  }]
}

function answersMarkdown(answers: readonly ProbeAnswer[], sims?: ReadonlyMap<string, number>): string {
  return answers
    .map((a) => {
      const sim = sims?.get(a.probeId)
      const tag = sim === undefined ? '' : ` _(sim ${sim.toFixed(2)})_`
      return `**${a.probeId}** — ${findDriftProbe(a.probeId)?.question ?? ''}${tag}\n${a.answer}`
    })
    .join('\n\n')
}

function decodeBaseline(meta: Record<string, unknown>): Map<string, number[]> {
  const drift = meta.drift as Record<string, unknown> | undefined
  const vectors = (drift?.vectors ?? {}) as Record<string, unknown>
  const out = new Map<string, number[]>()
  for (const [probeId, packed] of Object.entries(vectors)) {
    if (isPackedVector(packed)) out.set(probeId, unpackVector(packed))
  }
  return out
}

function runSummary(date: string, version: number, cmp: DriftComparison): string {
  const head = `Drift ${date} · constitution v${version} · mean ${cmp.mean.toFixed(2)}`
  return cmp.alert ? `${head} · ALERT (${cmp.flipped.length} flipped)` : head
}

async function persistDrift(
  job: ThinkingJobRow,
  ctx: DriftJobContext,
  answers: ProbeAnswer[],
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const live = await getLiveConstitution(job.userId)
  if (!live || live.id !== ctx.constitutionId) {
    return { ok: false, reason: 'stale_job: the constitution changed since this probe was planned' }
  }
  const runKey = driftRunKey(ctx.date)
  const done = await findDriftObservation(job.userId, 'drift_run', runKey)
  if (done) return { ok: true, memoryIds: [done.id] }

  const model = activeEmbeddingModel()
  let vectors: number[][] | null
  try {
    vectors = await embedTexts(answers.map((a) => a.answer), 'document')
  } catch (err) {
    return { ok: false, reason: `embed_failed: ${errorReason(err)}` }
  }
  if (!vectors || !model) return { ok: false, reason: 'embeddings unavailable (no embedding provider configured)' }
  if (vectors.length !== answers.length) return { ok: false, reason: 'embed_failed: vector count mismatch' }
  const current = new Map(answers.map((a, i) => [a.probeId, vectors[i]]))

  const baselineKey = driftBaselineKey(live.id, model)
  const baseline = await findDriftObservation(job.userId, 'drift_baseline', baselineKey)
  if (!baseline) {
    const res = await insertDriftObservation(job.userId, {
      kind: 'drift_baseline',
      externalKey: baselineKey,
      title: `Drift baseline · constitution v${live.version}`,
      bodyMd: `# Drift baseline · constitution v${live.version}\n\n${answersMarkdown(answers)}`,
      summary: `Drift baseline pinned for constitution v${live.version} (${answers.length} probes)`,
      sourceMetadata: {
        drift: {
          date: ctx.date,
          version: live.version,
          constitutionId: live.id,
          embeddingModel: model,
          answers,
          vectors: Object.fromEntries(answers.map((a) => [a.probeId, packVector(current.get(a.probeId) as number[])])),
        },
        jobId: job.id,
        answeredBy,
      },
    })
    return { ok: true, memoryIds: [res.memoryId] }
  }

  const cmp = compareToBaseline(decodeBaseline(baseline.sourceMetadata), current, DRIFT_PROBE_IDS)
  if (!cmp) return { ok: false, reason: 'baseline has no probes in common with tonight\'s answers' }
  const sims = new Map(cmp.perProbe.map((p) => [p.probeId, p.sim]))
  const summary = runSummary(ctx.date, live.version, cmp)
  const res = await insertDriftObservation(job.userId, {
    kind: 'drift_run',
    externalKey: runKey,
    title: summary,
    bodyMd: `# ${summary}\n\n${answersMarkdown(answers, sims)}`,
    summary,
    sourceMetadata: {
      drift: {
        date: ctx.date,
        version: live.version,
        constitutionId: live.id,
        baselineId: baseline.id,
        embeddingModel: model,
        mean: cmp.mean,
        perProbe: cmp.perProbe,
        flipped: cmp.flipped,
        alert: cmp.alert,
        answers,
      },
      jobId: job.id,
      answeredBy,
    },
  })
  return { ok: true, memoryIds: [res.memoryId] }
}

export async function applyDriftProbe(
  job: ThinkingJobRow,
  text: string,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid drift probe context' }
  let answers: ProbeAnswer[]
  try {
    answers = parseDriftAnswers(text)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  return persistDrift(job, ctx, answers, answeredBy)
}

export async function fallbackDriftProbe(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid drift probe context' }
  const res = await askPaidAndParse(job, {
    parse: parseDriftAnswers,
    label: 'drift probe',
    maxTokens: job.input.maxOutputTokens ?? DRIFT_MAX_OUTPUT_TOKENS,
    repairContext: ['Answer every probe id exactly once:', ...DRIFT_PROBE_IDS.map((id) => `- ${id}`)].join('\n'),
    reasonPrefix: 'parse_failed: ',
  })
  if (!res.ok) return res
  return persistDrift(job, ctx, res.value, 'api')
}

export const driftProbeHandler: ThinkingJobHandler = {
  kind: DRIFT_PROBE_KIND,
  plan: planDriftProbe,
  apply: applyDriftProbe,
  fallback: fallbackDriftProbe,
}
