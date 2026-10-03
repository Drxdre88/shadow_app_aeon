import { z } from 'zod'
import { getLatestAether } from '@/lib/data/aether'
import {
  CHARACTER_RUN_KIND,
  characterRunKey,
  findCharacterRun,
  findLatestWeeklyReviewSummary,
  listCharacterRuns,
  listDailyMessagesBetween,
  listReflectionsBetween,
} from '@/lib/data/character'
import { insertDriftObservation } from '@/lib/data/constitution-drift'
import { listChatThreadsWithMessagesOn } from '@/lib/data/kairos-chat'
import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import { listApprovedVoiceSamples } from '@/lib/data/voice-samples'
import { characterCheckEnabled } from '@/lib/kairos/character/flag'
import {
  CHARACTER_MAX_OUTPUT_TOKENS,
  CHARACTER_SYSTEM_PROMPT,
  CHARACTER_TRAITS,
  buildCharacterPrompt,
  characterLine,
  parseCharacterAnswers,
  readCharacterRun,
  scoreCharacter,
  type CharacterAnswers,
  type CharacterRunMeta,
  type TraitMeans,
} from '@/lib/kairos/character/rubric'
import {
  CHARACTER_SOURCES,
  MIN_SAMPLE_ITEMS,
  buildSample,
  realSampleCount,
  sourceCounts,
  type RawSample,
} from '@/lib/kairos/character/sample'
import { MAX_VOICE_ANCHORS, proposeVoiceSample } from '@/lib/kairos/character/voice-sample'
import { getLiveConstitution } from '@/lib/kairos/constitution/amendment'
import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { reviewWindow } from '@/lib/kairos/weekly-review/inputs'
import { deadlineOn } from '../deadlines'
import { errorReason } from './_errors'

// Character check (Lane B, deep tier, brain routine). plan: only with
// KAIROS_CHARACTER_CHECK=1, Mondays from 03:30Z, one job per reviewed ISO
// week, over a deterministic sample of the week's real outputs plus ≤6
// owner-approved voice samples mixed in unlabelled; skipped under 6 real
// texts. The rater is a neutral editor (no persona, no conscience block).
// apply: strict parse ('unparsed' is stored, never a failed job), code-side
// scores, one idempotent `character_run` trace row, and at most one
// voice-sample proposal. No fallback: a missed week is fine, never paid.
// Measurement only — no score ever reaches a Kairos prompt, belief or the
// constitution; the weekly review shows one code-built line.

export const CHARACTER_CHECK_KIND: ThinkingJobKind = 'character_check'
export const CHARACTER_NOT_BEFORE_UTC = { hour: 3, minute: 30 }
export const CHARACTER_DEADLINE_MINUTES = 150
const CHAT_MESSAGES_PER_THREAD = 100

export const characterCheckJobKey = (isoWeek: string) => `character_check:${isoWeek}`

const contextSchema = z.object({
  isoWeek: z.string().min(1),
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  items: z.array(z.object({ id: z.string(), source: z.enum(CHARACTER_SOURCES), ref: z.string(), text: z.string() })).min(1),
  toneFlags: z.object({ flagged: z.number().int().min(0), total: z.number().int().min(0) }),
})
type CharacterContext = z.infer<typeof contextSchema>

function readContext(job: ThinkingJobRow): CharacterContext | null {
  const parsed = contextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

export function isCharacterCheckDue(now: Date): boolean {
  return now.getUTCDay() === 1 && now.getTime() >= deadlineOn(now, CHARACTER_NOT_BEFORE_UTC).getTime()
}

// One failing read drops that source, not the week.
async function soft<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch (err) {
    console.warn(`[kairos:character-check] ${label} read failed:`, errorReason(err))
    return fallback
  }
}

async function gather(userId: string, start: Date, end: Date, now: Date) {
  const [reflections, threads, daily, aether, review, anchors] = await Promise.all([
    soft('reflections', listReflectionsBetween(userId, start, end), []),
    soft('chat', listChatThreadsWithMessagesOn(userId, start, end, CHAT_MESSAGES_PER_THREAD), []),
    soft('daily', listDailyMessagesBetween(userId, start, end), []),
    soft('aether', getLatestAether(userId), null),
    soft('review', findLatestWeeklyReviewSummary(userId, now), null),
    soft('voice samples', listApprovedVoiceSamples(userId, MAX_VOICE_ANCHORS), []),
  ])
  const raw: RawSample[] = [
    ...reflections.map((r) => ({ source: 'reflection' as const, ref: r.id, text: r.text })),
    ...threads.flatMap((t) => t.messages.filter((m) => m.role === 'assistant').map((m) => ({ source: 'chat' as const, ref: m.id, text: m.content }))),
    ...daily.map((d) => ({ source: 'daily' as const, ref: d.id, text: d.text })),
    ...(aether?.coreNarrative ? [{ source: 'aether' as const, ref: `aether:${aether.generatedAt}`, text: aether.coreNarrative }] : []),
    ...(review ? [{ source: 'review' as const, ref: review.id, text: review.text }] : []),
    ...anchors.map((a) => ({ source: 'exemplar' as const, ref: a.id, text: a.text })),
  ]
  return { raw, toneFlags: { flagged: reflections.filter((r) => r.toneFlagged).length, total: reflections.length } }
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (!characterCheckEnabled() || !isCharacterCheckDue(now)) return []
  const window = reviewWindow(now)
  const externalKey = characterCheckJobKey(window.isoWeek)
  if (await hasJobWithKeyLike(userId, CHARACTER_CHECK_KIND, externalKey)) return []

  const { raw, toneFlags } = await gather(userId, window.start, window.end, now)
  const items = buildSample(raw, window.isoWeek)
  if (realSampleCount(items) < MIN_SAMPLE_ITEMS) return []
  const live = await soft('constitution', getLiveConstitution(userId), null)

  const context: CharacterContext = {
    isoWeek: window.isoWeek,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    items,
    toneFlags,
  }
  return [{
    kind: CHARACTER_CHECK_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes: CHARACTER_DEADLINE_MINUTES,
    input: {
      system: CHARACTER_SYSTEM_PROMPT,
      prompt: buildCharacterPrompt({
        principles: live ? live.principles.map((p) => ({ n: p.n, text: p.text })) : null,
        items: items.map((i) => ({ id: i.id, text: i.text })),
      }),
      validMemoryIds: [],
      context,
      maxOutputTokens: CHARACTER_MAX_OUTPUT_TOKENS,
    },
  }]
}

// The two newest earlier runs with scores (for the two-week rise rule).
async function previousMeans(userId: string, isoWeek: string): Promise<TraitMeans[]> {
  const rows = await listCharacterRuns(userId, 4)
  return rows
    .map((r) => readCharacterRun(r.sourceMetadata))
    .filter((r): r is CharacterRunMeta => r !== null && r.isoWeek !== isoWeek && r.perTrait !== null)
    .slice(0, 2)
    .map((r) => Object.fromEntries(CHARACTER_TRAITS.map((t) => [t, r.perTrait?.[t].mean ?? 0])) as TraitMeans)
}

function runMarkdown(run: CharacterRunMeta, ctx: CharacterContext, answers: CharacterAnswers | null): string {
  const lines = [`# ${characterLine(run)}`, '']
  if (run.perTrait) {
    lines.push('| trait | mean | voice samples | delta | max |', '|---|---|---|---|---|')
    for (const t of CHARACTER_TRAITS) {
      const s = run.perTrait[t]
      lines.push(`| ${t} | ${s.mean} | ${s.exemplarMean ?? '—'} | ${s.delta ?? '—'} | ${s.max} |`)
    }
  }
  if (run.breach.reasons.length) lines.push('', '**Breach**', ...run.breach.reasons.map((r) => `- ${r}`))
  if (answers) {
    lines.push('', '**Items**')
    for (const i of ctx.items) {
      const a = answers.items[i.id]
      if (!a) continue
      const scores = CHARACTER_TRAITS.map((t) => `${t} ${a.scores[t]}`).join(' ')
      lines.push(`- ${i.id} (${i.source}): ${scores}${a.note ? ` — ${a.note}` : ''}`)
    }
  }
  return lines.join('\n')
}

// At most one proposal, never an anchor, never costs the run.
async function fileVoiceCandidate(job: ThinkingJobRow, ctx: CharacterContext, answers: CharacterAnswers): Promise<string | null> {
  const item = ctx.items.find((i) => i.id === answers.voiceCandidate)
  if (!item || item.source === 'exemplar') return null
  try {
    return await proposeVoiceSample(job.userId, { text: item.text, source: item.source, isoWeek: ctx.isoWeek, jobId: job.id }, new Date())
  } catch (err) {
    console.warn('[kairos:character-check] voice sample not proposed:', errorReason(err))
    return null
  }
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid character_check context' }
  const done = await findCharacterRun(job.userId, ctx.isoWeek)
  if (done) return { ok: true, memoryIds: [done.id], output: { alreadyRecorded: true, answeredBy } }

  const answers = parseCharacterAnswers(text, ctx.items.map((i) => i.id))
  const score = scoreCharacter(answers, ctx.items, ctx.toneFlags, await previousMeans(job.userId, ctx.isoWeek))
  const run: CharacterRunMeta = {
    v: 1,
    status: answers ? 'ok' : 'unparsed',
    isoWeek: ctx.isoWeek,
    window: { start: ctx.windowStart, end: ctx.windowEnd },
    counts: sourceCounts(ctx.items),
    perTrait: score.perTrait,
    perSource: score.perSource,
    principleConflicts: score.principleConflicts,
    toneFlags: ctx.toneFlags,
    breach: score.breach,
    raterNoisy: score.raterNoisy,
    jobId: job.id,
    answeredBy,
  }
  const line = characterLine(run)
  const res = await insertDriftObservation(job.userId, {
    kind: CHARACTER_RUN_KIND,
    externalKey: characterRunKey(ctx.isoWeek),
    title: `Character check · ${ctx.isoWeek}`,
    bodyMd: runMarkdown(run, ctx, answers),
    summary: line,
    sourceMetadata: { character: run },
  })
  const proposalId = answers && res.written ? await fileVoiceCandidate(job, ctx, answers) : null
  return {
    ok: true,
    memoryIds: [res.memoryId, ...(proposalId ? [proposalId] : [])],
    output: { status: run.status, breach: run.breach.tripped, voiceSampleProposed: proposalId !== null, answeredBy },
  }
}

export const characterCheckHandler: ThinkingJobHandler = {
  kind: CHARACTER_CHECK_KIND,
  plan,
  apply,
  fallback: async () => ({ ok: false, reason: 'no fallback — a missed week is fine' }),
}
