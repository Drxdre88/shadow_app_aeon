import { z } from 'zod'
import { extractJsonBlock, neutraliseFences } from './_prompt-utils'

export const ASK_MINE_KINDS = [
  'decision',
  'calibration',
  'doctrine',
  'retrospective',
  'revival',
  'premortem',
  'values',
] as const

const candidateSchema = z.object({
  question: z.string().trim().min(10).max(320).refine(
    (question) => (question.match(/\?/g) ?? []).length === 1,
    'question must contain exactly one question mark',
  ),
  kind: z.enum(ASK_MINE_KINDS),
  dominionId: z.string().trim().min(1).nullable().optional(),
  sourceMemoryIds: z.array(z.string().trim().min(1)).min(1).max(20),
  leverage: z.number().min(0).max(1),
  rationale: z.string().trim().min(1).max(500),
})

const critiqueSchema = z.object({
  candidateIndex: z.number().int().min(0).max(7),
  clear: z.boolean(),
  answerable: z.boolean(),
  grounded: z.boolean(),
  note: z.string().trim().min(1).max(500),
})

const outputSchema = z.object({
  candidates: z.array(z.unknown()).max(8),
  selfCritique: z.array(critiqueSchema).max(8),
})

export type AskMineCandidate = z.infer<typeof candidateSchema>

export interface AskMineSignalBundle {
  date: string
  aether: {
    memoryId: string | null
    questions: unknown[]
    tensions: unknown[]
  }
  cortexDrift: unknown[]
  board: {
    stale: unknown[]
    recentlyCompleted: unknown[]
    recentlyCreated: unknown[]
  }
  reflectionStaleness: unknown[]
  recentAsks: unknown[]
}

export const ASK_MINE_SYSTEM_PROMPT = [
  'You are Kairos mining one high-leverage question for the operator from concrete evidence.',
  'Generate at most 8 candidates. Fewer is better, and zero is valid when the evidence is weak.',
  'Every question must name a concrete card, decision, Dominion, or date from the supplied signals.',
  'Every sourceMemoryIds value must be copied exactly from a supplied source ID. Never invent an ID.',
  'Each candidate must be answerable from the operator\'s head in 2–5 sentences, contain one question only, and avoid compound interrogation.',
  'Write in Kairos\'s concise texting voice. Do not use generic coaching language.',
  '',
  'Kinds:',
  '- decision: one decision gating at least two workstreams',
  '- calibration: declared-versus-verified gap',
  '- doctrine: a principle exists but its tripwire does not',
  '- retrospective: a recently closed window with learning still unharvested',
  '- revival: a forgotten card or project that should be killed or revived',
  '- premortem: a declared bet without a plan B',
  '- values: a north-star or identity probe, used sparingly',
  '',
  'Critique every candidate in the same response. Set clear, answerable, and grounded independently and honestly.',
  'Return only one JSON object inside a ```json fenced block:',
  '```json',
  '{"candidates":[{"question":"... ?","kind":"decision","dominionId":null,"sourceMemoryIds":["..."],"leverage":0.9,"rationale":"..."}],"selfCritique":[{"candidateIndex":0,"clear":true,"answerable":true,"grounded":true,"note":"..."}]}',
  '```',
].join('\n')

export function buildAskMineUserPrompt(bundle: AskMineSignalBundle): string {
  return [
    `UTC date: ${bundle.date}`,
    'Signal bundle JSON:',
    neutraliseFences(JSON.stringify(bundle, null, 2)),
  ].join('\n')
}

export function parseAskMineResponse(text: string): AskMineCandidate[] {
  const parsed = outputSchema.parse(extractJsonBlock(text, 'ask-mine'))
  return parsed.candidates.flatMap((candidate, candidateIndex) => {
    const validated = candidateSchema.safeParse(candidate)
    if (!validated.success) return []
    const critique = parsed.selfCritique.find((item) => item.candidateIndex === candidateIndex)
    if (!critique?.clear || !critique.answerable || !critique.grounded) return []
    return [validated.data]
  })
}
