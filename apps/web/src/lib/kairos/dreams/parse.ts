import { z } from 'zod'
import { extractJsonBlock } from '@/lib/kairos/_prompt-utils'
import { DREAM_DISTORTIONS } from './distort'
import { dreamFingerprints } from './fingerprint'
import { AGE_BUCKETS, DREAM_MIN_PICKS, DREAM_SEED_KINDS } from './pick'
import { DREAM_SCENE_MAX, DREAM_SEED_ECHO_MAX, DREAM_TEXT_MAX, DREAM_TITLE_MAX } from './prompt'

export const DREAM_KIND = 'dream'
export const dreamJobKey = (date: string) => `${DREAM_KIND}:${date}`

export const dreamContextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memories: z.array(z.object({
    alias: z.string().regex(/^m\d+$/),
    id: z.string().min(1),
    dominionId: z.string().nullable(),
    bucket: z.enum(AGE_BUCKETS),
    distortion: z.enum(DREAM_DISTORTIONS),
  })).min(DREAM_MIN_PICKS),
  seeds: z.array(z.object({
    alias: z.string().regex(/^s\d+$/),
    kind: z.enum(DREAM_SEED_KINDS),
    ref: z.string().min(1),
  })).min(1),
})
export type DreamJobContext = z.infer<typeof dreamContextSchema>

const text = (max: number) => z.string().trim().min(1).max(max)

export const dreamModelSchema = z.object({
  title: text(DREAM_TITLE_MAX),
  scenes: z.array(z.object({
    ref: z.string().trim().min(1),
    distortion: z.enum(DREAM_DISTORTIONS),
    text: text(DREAM_SCENE_MAX),
  }).strict()).min(1),
  dream: text(DREAM_TEXT_MAX),
  seedEcho: text(DREAM_SEED_ECHO_MAX),
}).strict()
export type DreamModelOutput = z.infer<typeof dreamModelSchema>

// The output the dream job stores (and the only place dream text lives).
// dream_read reads it back with readDreamOutput.
export const dreamJobOutputSchema = z.object({
  dreamt: z.literal(true),
  v: z.literal(1),
  date: z.string(),
  title: z.string(),
  dream: z.string(),
  scenes: z.array(z.object({ memoryId: z.string(), distortion: z.enum(DREAM_DISTORTIONS), text: z.string() })),
  seeds: z.array(z.object({ alias: z.string(), kind: z.enum(DREAM_SEED_KINDS), ref: z.string() })),
  fingerprints: z.array(z.string()).max(64),
})
export type DreamJobOutput = z.infer<typeof dreamJobOutputSchema>

export function readDreamOutput(output: unknown): DreamJobOutput | null {
  const parsed = dreamJobOutputSchema.safeParse(output)
  return parsed.success ? parsed.data : null
}

// Strict: every scene cites a memory alias from tonight's picks, once, with
// exactly the distortion code assigned to it; at least two memories are used.
export function parseDreamText(raw: string, ctx: DreamJobContext): DreamModelOutput {
  const parsed = dreamModelSchema.safeParse(extractJsonBlock(raw, 'dream'))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`dream: ${issue.path.join('.') || 'output'} — ${issue.message}`)
  }
  const assigned = new Map(ctx.memories.map((m) => [m.alias, m.distortion]))
  const seen = new Set<string>()
  parsed.data.scenes.forEach((s, i) => {
    const want = assigned.get(s.ref)
    if (!want) throw new Error(`dream: scenes.${i}.ref — unknown memory alias`)
    if (seen.has(s.ref)) throw new Error(`dream: scenes.${i}.ref — memory used twice`)
    if (s.distortion !== want) throw new Error(`dream: scenes.${i}.distortion — expected ${want}`)
    seen.add(s.ref)
  })
  const minScenes = Math.min(DREAM_MIN_PICKS, ctx.memories.length)
  if (seen.size < minScenes) throw new Error(`dream: scenes — use at least ${minScenes} memories`)
  return parsed.data
}

export function buildDreamOutput(model: DreamModelOutput, ctx: DreamJobContext, sourceTexts: readonly string[]): DreamJobOutput {
  const idOf = new Map(ctx.memories.map((m) => [m.alias, m.id]))
  return {
    dreamt: true,
    v: 1,
    date: ctx.date,
    title: model.title,
    dream: model.dream,
    scenes: model.scenes.map((s) => ({ memoryId: idOf.get(s.ref)!, distortion: s.distortion, text: s.text })),
    seeds: ctx.seeds,
    fingerprints: dreamFingerprints([model.dream, ...model.scenes.map((s) => s.text)], sourceTexts),
  }
}
