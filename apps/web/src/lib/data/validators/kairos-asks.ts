import { z } from 'zod'

// Kairos open-question backlog (Q-numbered asks). Shared verbatim by the
// list_open_kairos_asks / dismiss_kairos_ask / answer_asks_from_message MCP
// tools and the /api/v1/kairos/asks REST routes (locked by
// kairos-asks-parity.test.ts).

export const listOpenKairosAsksSchema = z.object({})

export const dismissKairosAskSchema = z.object({
  askId: z.string().uuid(),
})

export type DismissKairosAskInput = z.infer<typeof dismissKairosAskSchema>

// The owner's message, relayed verbatim, plus the text of the message it
// replies to (e.g. a "Vorath asks (Q14)" card that is the thread root).
export const answerAsksFromMessageSchema = z.object({
  message: z.string().trim().min(1).max(10000),
  repliedToText: z.string().max(10000).optional(),
})

export type AnswerAsksFromMessageInput = z.infer<typeof answerAsksFromMessageSchema>
