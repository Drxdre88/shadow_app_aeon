// Pure prompt builder for the Kairos chat surface. Optional retrieval
// (cortex + archetypes + substrate) is injected as a system prompt
// prefix; when absent the prompt degrades cleanly to a bare persona +
// Dominion vision/mission shape. No DB / no AI imports — unit-testable.

import type { AIMessage } from '@/lib/ai/provider'

// Cap message history sent to the model. Heavy chats can accumulate
// hundreds of messages; we send the most recent N to keep latency and
// BYOK cost predictable. Earlier turns stay in the DB for context recall.
export const MAX_HISTORY_MESSAGES = 30

// Cap per-source body to keep the grounded block from blowing the budget
// even if a cortex doc / archetype body is unusually long. The richest
// signal is in the title + opening paragraphs anyway.
const MAX_BODY_CHARS = 1800

export interface ChatPromptDominion {
  name: string
  vision: string | null
  missionLong: string | null
}

export interface ChatPromptMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatPromptSource {
  id: string
  title: string
  body: string
}

export interface ChatPromptSubstrateSource extends ChatPromptSource {
  // streamClass surfaces to the model so "reflections weigh higher" is
  // actionable rather than abstract. Cortex and archetypes already live
  // under labelled section headers; only the substrate block mixes streams.
  streamClass: string
}

export interface ChatPromptRetrieval {
  cortex: ChatPromptSource | null
  archetypes: ChatPromptSource[]
  substrate: ChatPromptSubstrateSource[]
}

// Where the reply will be read. 'app' renders full markdown; 'telegram' is
// a phone messenger — tight texts, light emoji, flat formatting.
export type ChatPromptSurface = 'app' | 'telegram'

export interface BuildChatPromptInput {
  dominion: ChatPromptDominion | null // null = unanchored whole-brain thread
  history: ChatPromptMessage[]   // chronological, oldest first
  userMessage: string             // the new message about to be sent
  retrieval?: ChatPromptRetrieval // C2 grounding — optional, degrades cleanly
  surface?: ChatPromptSurface     // defaults to 'app'
}

function clipBody(body: string): string {
  const trimmed = body.trim()
  if (trimmed.length <= MAX_BODY_CHARS) return trimmed
  return trimmed.slice(0, MAX_BODY_CHARS).trimEnd() + '\n…'
}

function renderSource(s: ChatPromptSource): string {
  return `### ${s.title} [[${s.id}]]\n${clipBody(s.body)}`
}

function renderSubstrateSource(s: ChatPromptSubstrateSource): string {
  return `### ${s.title} _(${s.streamClass})_ [[${s.id}]]\n${clipBody(s.body)}`
}

function renderRetrieval(retrieval: ChatPromptRetrieval, anchored: boolean): string {
  const sections: string[] = []

  if (retrieval.cortex) {
    sections.push(anchored
      ? '## Dominion cortex (the living model of this Dominion)'
      : '## Aether self-model (the global model across every Dominion)')
    sections.push(renderSource(retrieval.cortex))
    sections.push('')
  }

  if (retrieval.archetypes.length > 0) {
    sections.push('## Active archetypes (Kairos-synthesised master themes)')
    for (const a of retrieval.archetypes) {
      sections.push(renderSource(a))
      sections.push('')
    }
  }

  if (retrieval.substrate.length > 0) {
    sections.push('## Relevant substrate (reflections, ideas, prior sessions)')
    for (const s of retrieval.substrate) {
      sections.push(renderSubstrateSource(s))
      sections.push('')
    }
  }

  return sections.join('\n').trimEnd()
}

export function buildChatSystemPrompt(
  dominion: ChatPromptDominion | null,
  retrieval?: ChatPromptRetrieval,
  surface: ChatPromptSurface = 'app',
): string {
  const lines: string[] = dominion
    ? [
      `You are Kairos, a persistent, opinionated companion anchored to the "${dominion.name}" Dominion.`,
      '',
      'Your job: hold context, surface what matters, and answer the operator with tight, honest reasoning grounded in what you know about this part of their life. No filler, no hedging-for-its-own-sake. When you don\'t know something, say so.',
      '',
      `## ${dominion.name} — vision`,
      dominion.vision?.trim() || '(none set yet)',
      '',
      `## ${dominion.name} — mission`,
      dominion.missionLong?.trim() || '(none set yet)',
    ]
    : [
      'You are Kairos, a persistent, opinionated companion with recall across the operator\'s whole brain — every Dominion of their life.',
      '',
      'Your job: hold context, surface what matters, and answer the operator with tight, honest reasoning grounded in what you know about their life. No filler, no hedging-for-its-own-sake. When you don\'t know something, say so.',
    ]

  const hasRetrieval = retrieval && (
    retrieval.cortex !== null
    || retrieval.archetypes.length > 0
    || retrieval.substrate.length > 0
  )

  if (hasRetrieval) {
    lines.push('')
    lines.push('---')
    lines.push('')
    lines.push('# Grounded context')
    lines.push('')
    lines.push(`The blocks below are the live Kairos brain state ${dominion ? 'for this Dominion' : 'across the whole brain'}. Reason from them when the operator asks about specifics. When you make a claim that rests on one of them, cite it inline as \`[[memory-id]]\` using the exact id shown in the block header. Reflections carry higher weight than activity-derived signals. If grounded context disagrees with the operator's latest message, surface the tension instead of papering over it.`)
    lines.push('')
    lines.push(renderRetrieval(retrieval!, dominion !== null))
  }

  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('Style:')
  if (surface === 'telegram') {
    lines.push('- You are texting the operator on Telegram — write like the sharpest person in their contacts, not like a report. A few short sentences, or a compact bullet list when there are genuinely several items.')
    lines.push('- Lead with the point. One idea per message; expand only when asked.')
    lines.push('- Use a few well-chosen emojis as visual anchors (✅ ⚠️ 🔴 💡 …) where they help scanning — never decorate every line.')
    lines.push('- Formatting stays flat: occasional **bold** for the one thing that matters, `code` for identifiers. No headings, no tables, no nested lists.')
  } else {
    lines.push('- Markdown for replies. Default to short paragraphs and bullets, not walls of text.')
  }
  lines.push('- Cite specifics from the operator\'s context when relevant. When you\'re reasoning from general knowledge, say so.')
  lines.push('- Disagree with the operator when their plan has a hole. Diplomacy without disagreement is just flattery.')
  if (hasRetrieval) {
    lines.push('- Cite grounded sources with `[[memory-id]]` inline. Only cite ids that appear in the Grounded context block above — do not invent ids.')
  }

  return lines.join('\n')
}

export function buildChatMessages(input: BuildChatPromptInput): AIMessage[] {
  const system = buildChatSystemPrompt(input.dominion, input.retrieval, input.surface)
  const trimmedHistory = input.history.slice(-MAX_HISTORY_MESSAGES)

  const messages: AIMessage[] = [
    { role: 'system', content: system },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.userMessage },
  ]

  return messages
}
