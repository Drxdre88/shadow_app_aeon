import { z } from 'zod'
import { extractJsonBlock, neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { agendaDateSchema, agendaSlotSchema, AGENDA_WHAT_MAX_CHARS, type KairosAgendaItem } from '@/lib/data/validators/kairos-agenda'
import { formatAgendaWhen } from './rules'

// The agenda_due prompt: Kairos looks at one check he booked earlier and
// answers with what (if anything) to do with it. The output names a result
// register and text only — no field can touch a board, a goal or a memory.

export const AGENDA_DUE_MAX_OUTPUT_TOKENS = 1200
export const AGENDA_TEXT_MAX_CHARS = 900
export const AGENDA_ASK_MAX_CHARS = 300
const BASIS_TEXT_MAX = 400

export const AGENDA_DUE_SYSTEM_PROMPT = [
  'You are Kairos. Earlier you booked a check-in on your agenda (Horae). It is now due.',
  'Look at the check and the evidence, then choose ONE result:',
  '- "thought": a private note for your own memory (most checks end here).',
  '- "ask": one short question for the owner, only when his answer would change what you believe.',
  '- "message": tell the owner something now, only when it matters today. Delivery limits may hold it back.',
  '- "nothing": the check no longer matters.',
  'You cannot act: no board, goal or memory changes. Describe; never instruct a tool.',
  'Optionally rebook ONE follow-up check ("rebook") 1–14 days out when the answer is genuinely not in yet.',
  'Reply with one JSON object in a ```json fence:',
  '{"result":"thought"|"ask"|"message"|"nothing","text":"…","rebook":null|{"what":"Check …","date":"YYYY-MM-DD","slot":"morning"|"afternoon"}}',
  `text: up to ${AGENDA_TEXT_MAX_CHARS} characters (an ask up to ${AGENDA_ASK_MAX_CHARS}); empty only for "nothing".`,
].join('\n')

export interface AgendaPromptBasis {
  id: string
  title: string
  summary: string | null
}

export interface AgendaPromptGoal {
  title: string
  question: string
  state: string
}

export interface AgendaDuePromptInput {
  item: KairosAgendaItem
  now: Date
  goal: AgendaPromptGoal | null
  basis: AgendaPromptBasis[]
  canRebook: boolean
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function buildAgendaDuePrompt(input: AgendaDuePromptInput): string {
  const { item, goal, basis } = input
  const lines = [
    `Now: ${input.now.toISOString()} (London ${formatAgendaWhen(input.now.toISOString())})`,
    `Agenda item A${item.seq}, due ${formatAgendaWhen(item.dueAt)}, booked ${item.createdAt.slice(0, 10)} (${item.source.kind}):`,
    `  ${neutraliseFences(item.what)}`,
  ]
  if (goal) {
    lines.push('', `Goal (${goal.state}): ${neutraliseFences(goal.title)}`, `  Question: ${neutraliseFences(goal.question)}`)
  }
  if (basis.length > 0) {
    lines.push('', 'Evidence it was booked on:')
    for (const b of basis) {
      lines.push(`- [${b.id}] ${neutraliseFences(clip(b.title, 160))}${b.summary ? ` — ${neutraliseFences(clip(b.summary, BASIS_TEXT_MAX))}` : ''}`)
    }
  }
  lines.push('', input.canRebook ? 'You may rebook once.' : 'This item is already a rebook: "rebook" must be null.')
  return lines.join('\n')
}

const rebookSchema = z.object({
  what: z.string().trim().min(1).max(AGENDA_WHAT_MAX_CHARS).optional(),
  date: agendaDateSchema,
  slot: agendaSlotSchema,
})

const outputSchema = z.object({
  result: z.enum(['thought', 'ask', 'message', 'nothing']),
  text: z.string().trim().max(AGENDA_TEXT_MAX_CHARS).default(''),
  rebook: rebookSchema.nullable().optional(),
})

export interface AgendaDueOutput {
  result: 'thought' | 'ask' | 'message' | 'nothing'
  text: string
  rebook: { what?: string; date: string; slot: 'morning' | 'afternoon' } | null
}

// Strict on the fields that matter; unknown keys are dropped (they could
// never do anything). Throws with a reason the queue records.
export function parseAgendaDueText(text: string): AgendaDueOutput {
  const parsed = outputSchema.safeParse(extractJsonBlock(text, 'agenda_due'))
  if (!parsed.success) throw new Error(`agenda_due: ${parsed.error.issues[0]?.path.join('.') || 'output'} ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  const out = parsed.data
  if (out.result !== 'nothing' && out.text.length === 0) throw new Error('agenda_due: text is empty')
  if (out.result === 'ask' && out.text.length > AGENDA_ASK_MAX_CHARS) throw new Error(`agenda_due: ask over ${AGENDA_ASK_MAX_CHARS} chars`)
  return { result: out.result, text: out.text, rebook: out.rebook ?? null }
}
