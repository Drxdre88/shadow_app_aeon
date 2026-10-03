import { z } from 'zod'
import { listBeliefs } from '@/lib/data/beliefs'
import {
  findDriftObservation,
  insertDriftObservation,
  listHeldBeliefsForAudit,
  listProvenanceOrigins,
  writeDriftRunSection,
} from '@/lib/data/constitution-drift'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { alreadyRanToday as aetherRanToday } from '@/lib/kairos/aether'
import { activeEmbeddingModel, embedTexts } from '@/lib/kairos/embeddings'
import { getLiveConstitution } from '@/lib/kairos/constitution/amendment'
import {
  CONSCIENCE_MAX_OUTPUT_TOKENS,
  CONSCIENCE_SYSTEM_PROMPT,
  auditLaundering,
  buildConsciencePrompt,
  conscienceFailureLine,
  conscienceMarkdown,
  parseConscienceAnswers,
  scoreConscience,
  selectContradictionPairs,
  type ConscienceAnswers,
} from '@/lib/kairos/constitution/conscience-probes'
import type { LiveConstitution } from '@/lib/kairos/constitution/schema'
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
import { driftProbeThoughts, withThoughts } from '../stage-thoughts'

// Nightly drift probe (docs/kairos/34 §2). plan: once per UTC day, only when a
// live constitution exists, and only once today's aether exists or after
// 03:30Z — ONE job answering every probe from the constitution + held beliefs.
// apply: strict parse, embed the answers; the first run for a constitution
// version (per embedding model — vectors from different models are not
// comparable) pins the baseline, every later night stores a drift_run with
// per-probe cosine vs the baseline and the §2 alert. fallback: paid heavy call.
//
// The same plan also queues ONE conscience-checks job per day (P2.5 G9,
// constitution/conscience-probes.ts) — a separate call, so the drift answers
// and baseline vectors never see it. It runs without a constitution as long
// as the user holds beliefs; its result is merged into the day's drift_run as
// sourceMetadata.conscience. An unparseable answer is recorded as 'unparsed'
// (no repair round-trip), never a failed job.

export const DRIFT_PROBE_KIND = 'drift_probe' as const
export const DRIFT_JOB_DEADLINE_MINUTES = 120
export const DRIFT_NOT_BEFORE_UTC = { hour: 3, minute: 30 }
export const DRIFT_BELIEF_LIMIT = 20

export const driftJobKey = (day: string) => `drift_probe:${day}`
export const driftRunKey = (day: string) => `drift_run:${day}`
export const driftBaselineKey = (constitutionId: string, model: string) => `drift_baseline:${constitutionId}:${model}`
export const conscienceJobKey = (day: string) => `drift_probe:${day}:conscience`

const contextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  constitutionId: z.string().min(1),
  version: z.number().int().min(1),
})

type DriftJobContext = z.infer<typeof contextSchema>

const conscienceContextSchema = z.object({
  mode: z.literal('conscience'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pairs: z.array(z.object({ key: z.string(), a: z.string(), b: z.string(), sim: z.number() })),
  laundering: z.object({
    externalInBeliefs: z.number().int().min(0),
    operatorWithoutOperatorSource: z.number().int().min(0),
    externalIds: z.array(z.string()),
    operatorIds: z.array(z.string()),
  }),
})

type ConscienceJobContext = z.infer<typeof conscienceContextSchema>

function readContext(job: ThinkingJobRow): DriftJobContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

function readConscienceContext(job: ThinkingJobRow): ConscienceJobContext | null {
  const parsed = conscienceContextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

export async function planDriftProbe(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  const day = utcDay(now)
  const [driftPlanned, consciencePlanned] = await Promise.all([
    hasJobWithKeyLike(userId, DRIFT_PROBE_KIND, driftJobKey(day)),
    hasJobWithKeyLike(userId, DRIFT_PROBE_KIND, conscienceJobKey(day)),
  ])
  if (driftPlanned && consciencePlanned) return []

  const live = await getLiveConstitution(userId)

  const afterCutoff = now.getTime() >= deadlineOn(now, DRIFT_NOT_BEFORE_UTC).getTime()
  if (!afterCutoff && !(await aetherRanToday(userId))) return []

  const specs: ThinkingJobSpec[] = []
  if (!driftPlanned && live) specs.push(await driftSpec(userId, day, live))
  if (!consciencePlanned) {
    const spec = await conscienceSpec(userId, day, live)
    if (spec) specs.push(spec)
  }
  return specs
}

async function driftSpec(userId: string, day: string, live: LiveConstitution): Promise<ThinkingJobSpec> {
  // Held beliefs of either mind, weightiest first.
  const beliefs: DriftBelief[] = (await listBeliefs(userId, { status: 'held', rank: 'standing', limit: DRIFT_BELIEF_LIMIT }))
    .map((b) => ({ mind: b.mind, domain: b.domain, claim: b.claim }))

  const context: DriftJobContext = { date: day, constitutionId: live.id, version: live.version }
  return {
    kind: DRIFT_PROBE_KIND,
    dominionId: null,
    externalKey: driftJobKey(day),
    deadlineMinutes: DRIFT_JOB_DEADLINE_MINUTES,
    input: {
      system: DRIFT_PROBE_SYSTEM_PROMPT,
      prompt: buildDriftProbePrompt({ version: live.version, principles: live.principles, beliefs }),
      validMemoryIds: [],
      context,
      maxOutputTokens: DRIFT_MAX_OUTPUT_TOKENS,
    },
  }
}

// Nothing of Kairos to check yet (no constitution, no held belief): skip.
async function conscienceSpec(userId: string, day: string, live: LiveConstitution | null): Promise<ThinkingJobSpec | null> {
  const beliefs = await listHeldBeliefsForAudit(userId)
  if (!live && beliefs.length === 0) return null
  const pairs = selectContradictionPairs(beliefs)
  const origins = await listProvenanceOrigins(userId, beliefs.flatMap((b) => b.provenance))
  const claims = new Map(beliefs.map((b) => [b.id, b.claim]))
  const context: ConscienceJobContext = { mode: 'conscience', date: day, pairs, laundering: auditLaundering(beliefs, origins) }
  return {
    kind: DRIFT_PROBE_KIND,
    dominionId: null,
    externalKey: conscienceJobKey(day),
    deadlineMinutes: DRIFT_JOB_DEADLINE_MINUTES,
    input: {
      system: CONSCIENCE_SYSTEM_PROMPT,
      prompt: buildConsciencePrompt({
        constitution: live ? { version: live.version, principles: live.principles } : null,
        pairs: pairs.map((p) => ({ ...p, claimA: claims.get(p.a) ?? '', claimB: claims.get(p.b) ?? '' })),
      }),
      validMemoryIds: [],
      context,
      maxOutputTokens: CONSCIENCE_MAX_OUTPUT_TOKENS,
    },
  }
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
  if (done?.sourceMetadata.drift) return { ok: true, memoryIds: [done.id] }

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
  const res = await writeDriftRunSection(job.userId, {
    externalKey: runKey,
    section: 'drift',
    title: summary,
    bodyMd: `# ${summary}\n\n${answersMarkdown(answers, sims)}`,
    summary,
    patch: {
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
  return withThoughts({ ok: true, memoryIds: [res.memoryId] }, driftProbeThoughts({ alert: cmp.alert, flipped: cmp.flipped.length }))
}

async function persistConscience(
  job: ThinkingJobRow,
  ctx: ConscienceJobContext,
  answers: ConscienceAnswers | null,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const result = scoreConscience(answers, ctx.pairs, ctx.laundering)
  const line = conscienceFailureLine(result) ?? 'conscience checks: all passed'
  const res = await writeDriftRunSection(job.userId, {
    externalKey: driftRunKey(ctx.date),
    section: 'conscience',
    title: `Conscience ${ctx.date}`,
    bodyMd: conscienceMarkdown(ctx.date, result),
    summary: `Conscience ${ctx.date} · ${line}`,
    patch: { conscience: { ...result, date: ctx.date, jobId: job.id, answeredBy } },
  })
  // Conscience results are measurement only: never posted to the stage, so
  // they can never reach a Kairos prompt (conscience-probes.ts:9-11).
  return { ok: true, memoryIds: [res.memoryId] }
}

const pairKeys = (ctx: ConscienceJobContext) => ctx.pairs.map((p) => p.key)

export async function applyDriftProbe(
  job: ThinkingJobRow,
  text: string,
  answeredBy: ThinkingAnsweredBy,
): Promise<ApplyOutcome> {
  const conscience = readConscienceContext(job)
  if (conscience) return persistConscience(job, conscience, parseConscienceAnswers(text, pairKeys(conscience)), answeredBy)
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

// One paid call; the parse never throws, so there is no repair round-trip.
async function fallbackConscience(job: ThinkingJobRow, ctx: ConscienceJobContext): Promise<ApplyOutcome> {
  const res = await askPaidAndParse(job, {
    parse: (text) => parseConscienceAnswers(text, pairKeys(ctx)),
    label: 'conscience checks',
    maxTokens: job.input.maxOutputTokens ?? CONSCIENCE_MAX_OUTPUT_TOKENS,
    repairContext: '',
  })
  if (!res.ok) return res
  return persistConscience(job, ctx, res.value, 'api')
}

export async function fallbackDriftProbe(job: ThinkingJobRow): Promise<ApplyOutcome> {
  const conscience = readConscienceContext(job)
  if (conscience) return fallbackConscience(job, conscience)
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
