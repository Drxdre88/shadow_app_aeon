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
  'Telegram typography — compose the "question" text itself using this anatomy (it renders as Telegram HTML: **bold**, `>` quote, `>>!` collapsed quote, ~~strike~~, ||spoiler||):',
  '1. Open with ONE **bold** headline, at most 60 characters, at most one emoji, concrete not generic.',
  '2. Flat short paragraphs — a one-sentence hook then a couple of short sentences. No bullet walls.',
  '3. Exactly one visible quote of real evidence on a single "> " line (a drift signal, or a card name plus its age).',
  '4. Any further depth — extra sources, receipts, source ids — goes in exactly one collapsed block at the very end: consecutive lines opening with ">>! ".',
  '5. Use ~~strikethrough~~ to contrast a declared claim against what is actually verified.',
  '6. At most once, and only for asks, hide your own guess in a spoiler, e.g. "My guess: ||you will pick X|| — tell me I\'m wrong."',
  '7. At most two emoji total across the message.',
  '8. Close with the single question — it is the last sentence and the only "?" in the text.',
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
  // A malformed top-level response (non-JSON or schema-violating) degrades to
  // "no candidates today" — one bad model reply must not fail the whole run.
  let raw: unknown
  try {
    raw = extractJsonBlock(text, 'ask-mine')
  } catch {
    return []
  }
  const result = outputSchema.safeParse(raw)
  if (!result.success) return []
  const parsed = result.data
  return parsed.candidates.flatMap((candidate, candidateIndex) => {
    const validated = candidateSchema.safeParse(candidate)
    if (!validated.success) return []
    const critique = parsed.selfCritique.find((item) => item.candidateIndex === candidateIndex)
    if (!critique?.clear || !critique.answerable || !critique.grounded) return []
    return [validated.data]
  })
}
