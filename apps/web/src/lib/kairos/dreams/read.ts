import { z } from 'zod'
import { listJobs } from '@/lib/data/thinking-jobs'
import type { StageCandidateInput } from '@/lib/kairos/stage/types'
import type { DreamFragile, DreamReadOutput, DreamRehearsal } from './read-parse'

// Morning read: stage thoughts and read-only readers over dream_read job
// outputs (spec_dreams, lane C). Fiction must not rewrite beliefs: nothing in
// this module changes standing/confidence, writes a memory or books Horae.

export const DREAM_READ_KIND = 'dream_read' as const
export const dreamReadJobKey = (date: string) => `${DREAM_READ_KIND}:${date}`
export const DREAM_HUNCH_PREFIX = 'Dream hunch: '

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

// ≤1 "Dream hunch:" pattern (the strongest hold) + an optional rehearsal.
// Speculative by construction: surprise 0 and no cites, so a dream never
// ignites the stage or triggers an early reflection; the queue forces the
// light tier (STAGE_SPECULATIVE_KINDS).
export function dreamReadThoughts(out: Pick<DreamReadOutput, 'holds' | 'rehearsal'>): StageCandidateInput[] {
  const thoughts: StageCandidateInput[] = []
  const hold = out.holds[0]
  if (hold) {
    thoughts.push({ text: clip(`${DREAM_HUNCH_PREFIX}${hold.pattern}`, 240), importance: 0.4, surprise: 0, goalRelevance: 0.2, need: 0.2, cites: [] })
  }
  const r = out.rehearsal
  if (r) {
    thoughts.push({
      text: clip(`${DREAM_HUNCH_PREFIX}worst case for "${r.subject}" — ${r.worstCase} Early sign: ${r.earlySign} Guard: ${r.guard}`, 400),
      importance: 0.4,
      surprise: 0,
      goalRelevance: 0.5,
      need: 0.3,
      cites: [],
    })
  }
  return thoughts
}

// Lenient read-back of stored outputs: a malformed row is skipped, never thrown.
const storedSchema = z.object({
  dreamt: z.literal(true),
  v: z.literal(1),
  date: z.string(),
  dreamJobId: z.string(),
  holds: z.array(z.object({ pattern: z.string(), memoryIds: z.array(z.string()) })),
  fragile: z.array(z.union([
    z.object({ beliefId: z.string().nullable(), claim: z.string(), situation: z.string(), why: z.string() }),
    z.object({ principleIndex: z.number().int(), situation: z.string(), why: z.string() }),
  ])),
  rehearsal: z.object({
    goalId: z.string().optional(),
    promiseId: z.string().optional(),
    subject: z.string(),
    worstCase: z.string(),
    earlySign: z.string(),
    guard: z.string(),
  }).nullable(),
  morningLine: z.string().nullable(),
})

export function readDreamReadOutput(raw: unknown): DreamReadOutput | null {
  const parsed = storedSchema.safeParse(raw)
  return parsed.success ? (parsed.data as DreamReadOutput) : null
}

interface Dated { date: string; jobId: string }
export type DreamFragileNote = DreamFragile & Dated
export type DreamRehearsalNote = DreamRehearsal & Dated

async function readOutputs(userId: string, sinceDays: number, now: Date): Promise<Array<{ jobId: string; out: DreamReadOutput }>> {
  const days = Math.min(Math.max(Math.floor(sinceDays), 1), 90)
  const since = new Date(now.getTime() - days * 86_400_000)
  const jobs = await listJobs(userId, { kind: DREAM_READ_KIND, status: 'done', since, limit: 200 })
  return jobs.flatMap((j) => {
    const out = readDreamReadOutput(j.output)
    return out ? [{ jobId: j.id, out }] : []
  })
}

// Beliefs/principles a recent dream put under strain — a note only; the
// belief's standing and confidence are never touched. Newest first.
export async function listDreamFragile(userId: string, sinceDays: number, now: Date = new Date()): Promise<DreamFragileNote[]> {
  const rows = await readOutputs(userId, sinceDays, now)
  return rows.flatMap(({ jobId, out }) => out.fragile.map((f) => ({ ...f, date: out.date, jobId })))
}

// Worst cases rehearsed for goals/promises. Newest first.
export async function listDreamRehearsals(userId: string, sinceDays: number, now: Date = new Date()): Promise<DreamRehearsalNote[]> {
  const rows = await readOutputs(userId, sinceDays, now)
  return rows.flatMap(({ jobId, out }) => (out.rehearsal ? [{ ...out.rehearsal, date: out.date, jobId }] : []))
}
