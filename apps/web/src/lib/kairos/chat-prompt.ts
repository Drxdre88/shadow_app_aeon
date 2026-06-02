// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (C1) — pure prompt builder for the chat surface.
//
// C1 ships BARE chat: no per-message memory retrieval yet. The system
// prompt establishes Kairos's persona + the anchored Dominion only.
// C2 will extend this with cortex prefix + retrieved memory citations.
//
// Kept pure (no DB / no AI imports) so unit tests don't boot the DB.
// ─────────────────────────────────────────────────────────────────────────

import type { AIMessage } from '@/lib/ai/provider'

// Cap message history sent to the model. Heavy chats can accumulate
// hundreds of messages; we send the most recent N to keep latency and
// BYOK cost predictable. Earlier turns stay in the DB for context recall.
export const MAX_HISTORY_MESSAGES = 30

export interface ChatPromptDominion {
  name: string
  vision: string | null
  missionLong: string | null
}

export interface ChatPromptMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface BuildChatPromptInput {
  dominion: ChatPromptDominion
  history: ChatPromptMessage[]   // chronological, oldest first
  userMessage: string             // the new message about to be sent
}

export function buildChatSystemPrompt(dominion: ChatPromptDominion): string {
  const lines: string[] = [
    `You are Kairos, a persistent, opinionated companion anchored to the "${dominion.name}" Dominion.`,
    '',
    'Your job: hold context, surface what matters, and answer the operator with tight, honest reasoning grounded in what you know about this part of their life. No filler, no hedging-for-its-own-sake. When you don\'t know something, say so.',
    '',
    `## ${dominion.name} — vision`,
    dominion.vision?.trim() || '(none set yet)',
    '',
    `## ${dominion.name} — mission`,
    dominion.missionLong?.trim() || '(none set yet)',
    '',
    'Style:',
    '- Markdown for replies. Default to short paragraphs and bullets, not walls of text.',
    '- Cite specifics from the operator\'s context when relevant. When you\'re reasoning from general knowledge, say so.',
    '- Disagree with the operator when their plan has a hole. Diplomacy without disagreement is just flattery.',
  ]
  return lines.join('\n')
}

export function buildChatMessages(input: BuildChatPromptInput): AIMessage[] {
  const system = buildChatSystemPrompt(input.dominion)
  const trimmedHistory = input.history.slice(-MAX_HISTORY_MESSAGES)

  const messages: AIMessage[] = [
    { role: 'system', content: system },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.userMessage },
  ]

  return messages
}
