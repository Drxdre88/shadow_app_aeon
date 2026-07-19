import { z } from 'zod'
import type { ChatMessage } from '@/lib/data/kairos-chat'
import { extractJsonBlock, neutraliseFences } from './_prompt-utils'

const reflectionSchema = z.object({
  title: z.string().trim().min(1).max(100),
  bodyMd: z.string().trim().min(1).max(2000),
})

// Envelope stays loose — candidates are validated INDIVIDUALLY below so one
// malformed entry drops alone instead of voiding the thread's valid ones.
const outputSchema = z.object({
  reflections: z.array(z.unknown()).default([]),
})

export type ChatDistillCandidate = z.infer<typeof reflectionSchema>

export const CHAT_DISTILL_SYSTEM_PROMPT = [
  'You distil Kairos chat into durable operator memories.',
  '',
  'Extract only durable signal explicitly stated by the USER: decisions, facts, preferences, intentions, and corrections Kairos should remember.',
  'ASSISTANT messages are context only. Never turn Kairos\'s suggestions, interpretations, guesses, or musings into the operator\'s voice.',
  'Never invent, strengthen, or generalise beyond what the user actually said. Do not infer agreement from silence or politeness.',
  'Ignore transient requests, greetings, status checks, brainstorming Kairos introduced, and details unlikely to matter later.',
  'Write each body as a concise first-person statement in the operator\'s voice. A few high-quality reflections beat many. Zero is a valid result.',
  '',
  'Return only one JSON object inside a ```json fenced block, with at most 5 reflections:',
  '```json',
  '{"reflections":[{"title":"Short durable title","bodyMd":"I decided ..."}]}',
  '```',
  'Use {"reflections":[]} when there is no durable operator signal.',
].join('\n')

export function buildChatDistillUserPrompt(
  thread: { title: string; messages: ChatMessage[] },
  date: string,
  askId?: string,
): string {
  const transcript = thread.messages.map((message) => ({
    seq: message.seq,
    role: message.role,
    content: neutraliseFences(message.content),
  }))
  const prompt = [
    `UTC date: ${date}`,
    `Thread: ${neutraliseFences(thread.title)}`,
    '',
    'Transcript JSON:',
    JSON.stringify(transcript, null, 2),
  ]
  if (askId) {
    prompt.splice(2, 0, `Resolved ask memory: ${askId}`, 'Treat the user answer to that ask as durable signal when it meets the rules above.')
  }
  return prompt.join('\n')
}

export function parseChatDistillResponse(text: string): ChatDistillCandidate[] {
  const parsed = outputSchema.parse(extractJsonBlock(text, 'chat-distill'))
  return parsed.reflections
    .map((candidate) => reflectionSchema.safeParse(candidate))
    .filter((result): result is { success: true; data: ChatDistillCandidate } => result.success)
    .map((result) => result.data)
    .slice(0, 5)
}
