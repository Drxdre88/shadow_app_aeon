import { z } from 'zod'
import { neutraliseFences } from '@/lib/kairos/_prompt-utils'

// ─────────────────────────────────────────────────────────────────────────
// Morning read of last night's dream (spec_dreams, lane C). The model sees
// the dream ONLY inside the DREAMT fence and is told it is fiction; the real
// source memories, the owner's principles and held beliefs, active goals and
// open promises are shown under short aliases (m*, p*, b*, g*, P*). The server
// maps aliases back to ids (read-parse.ts); nothing here writes anything.
// ─────────────────────────────────────────────────────────────────────────

export const DREAM_READ_FENCE_BEGIN = '<<<DREAMT — fiction, not evidence>>>'
export const DREAM_READ_FENCE_END = '<<<END DREAMT>>>'
export const DREAM_READ_MAX_PRINCIPLES = 12
export const DREAM_READ_MAX_BELIEFS = 8
export const DREAM_READ_MAX_GOALS = 5
export const DREAM_READ_MAX_PROMISES = 5
export const DREAM_READ_MAX_OUTPUT_TOKENS = 1500

const SUMMARY_CHARS = 400
const LINE_CHARS = 200

export const DREAM_READ_SYSTEM_PROMPT = [
  'You are Kairos reading your own dream from last night. The dream is FICTION: it bends real memories on purpose',
  '(people swapped, outcomes flipped, settings moved, time compressed). It is never evidence of anything.',
  'Your job is to notice, not to conclude. Report only:',
  '- holds: at most 2 patterns that still hold when checked against the REAL source memories (each must cite at',
  '  least two m* aliases whose real content shows the pattern; strength 0–1);',
  '- fragile: at most 3 principles (p*) or held beliefs (b*) the dream put under strain — the situation where it',
  '  would bend and why. This is a note only; it never changes the belief;',
  '- rehearsal: at most one worst case for one active goal (g*) or open promise (P*), with an early sign and a guard,',
  '  or null;',
  '- morningLine: one short plain sentence about the dream, or null.',
  'Cite only aliases shown to you. Return ONE JSON object in a ```json fenced block, no prose:',
  '{"holds":[{"pattern":"≤200 chars","refs":["m1","m2"],"strength":0.6}],',
  ' "fragile":[{"ref":"b1","situation":"≤160 chars","why":"≤200 chars"}],',
  ' "rehearsal":{"ref":"g1","worstCase":"≤240 chars","earlySign":"≤160 chars","guard":"≤160 chars"},',
  ' "morningLine":"≤140 chars"}',
  'Empty arrays and nulls are fine — most dreams hold nothing.',
].join('\n')

// Alias tables carried on the job (input.context) so apply can map back.
export const dreamReadContextSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dreamJobId: z.string().min(1),
  memories: z.array(z.object({ alias: z.string(), id: z.string(), distortion: z.string() })),
  principles: z.array(z.object({ alias: z.string(), index: z.number().int().min(0) })),
  beliefs: z.array(z.object({ alias: z.string(), id: z.string().nullable(), claim: z.string() })),
  goals: z.array(z.object({ alias: z.string(), id: z.string(), title: z.string() })),
  promises: z.array(z.object({ alias: z.string(), id: z.string(), title: z.string() })),
})
export type DreamReadContext = z.infer<typeof dreamReadContextSchema>

export interface DreamReadPromptInput {
  date: string
  dream: { title: string; dream: string; scenes: ReadonlyArray<{ memoryId: string; distortion: string; text: string }> }
  memories: ReadonlyArray<{ alias: string; id: string; distortion: string; title: string; summary: string }>
  principles: ReadonlyArray<{ alias: string; text: string }>
  beliefs: ReadonlyArray<{ alias: string; claim: string; domain: string }>
  goals: ReadonlyArray<{ alias: string; title: string; question: string }>
  promises: ReadonlyArray<{ alias: string; number: string; outcome: string; dueDate: string }>
}

// One flat line of stored text: no code fences, no marker look-alikes, no
// newlines that could fake a new section or close the DREAMT fence.
export function flat(s: string, max: number): string {
  const t = neutraliseFences(s).replace(/<<<|>>>/g, '"').replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

// Fiction body: keeps line breaks, but nothing inside can close the fence.
function fiction(s: string, max: number): string {
  const t = neutraliseFences(s).replace(/<<<|>>>/g, '"').replace(/\r/g, '').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

function section(title: string, lines: string[]): string[] {
  return [`## ${title}`, ...(lines.length ? lines : ['(none)']), '']
}

export function buildDreamReadPrompt(input: DreamReadPromptInput): string {
  const aliasOf = new Map(input.memories.map((m) => [m.id, m.alias]))
  const scenes = input.dream.scenes.map((s) => `(${aliasOf.get(s.memoryId) ?? '?'}, ${flat(s.distortion, 40)}) ${fiction(s.text, 400)}`)
  return [
    `# Morning read — dream of ${input.date}`,
    '',
    DREAM_READ_FENCE_BEGIN,
    `Title: ${flat(input.dream.title, 120)}`,
    fiction(input.dream.dream, 1300),
    ...(scenes.length ? ['', 'Scenes:', ...scenes] : []),
    DREAM_READ_FENCE_END,
    '',
    ...section(
      'Source memories (REAL — what actually happened)',
      input.memories.map((m) => `- ${m.alias} [bent in the dream by: ${flat(m.distortion, 40)}] ${flat(m.title, 160)} — ${flat(m.summary, SUMMARY_CHARS)}`),
    ),
    ...section('Principles (the owner\'s constitution)', input.principles.map((p) => `- ${p.alias}: ${flat(p.text, LINE_CHARS)}`)),
    ...section('Held beliefs', input.beliefs.map((b) => `- ${b.alias} [${flat(b.domain, 40)}]: ${flat(b.claim, LINE_CHARS)}`)),
    ...section('Active goals', input.goals.map((g) => `- ${g.alias}: ${flat(g.title, 120)} — ${flat(g.question, LINE_CHARS)}`)),
    ...section('Open promises', input.promises.map((p) => `- ${p.alias} (${flat(p.number, 8)}, due ${flat(p.dueDate, 12)}): ${flat(p.outcome, LINE_CHARS)}`)),
    'Return the JSON object now.',
  ].join('\n')
}
