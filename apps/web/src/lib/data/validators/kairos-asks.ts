import { z } from 'zod'

// Kairos open-question backlog (Q-numbered asks). Shared verbatim by the
// list_open_kairos_asks / dismiss_kairos_ask MCP tools and the
// /api/v1/kairos/asks REST routes (locked by kairos-asks-parity.test.ts).

export const listOpenKairosAsksSchema = z.object({})

export const dismissKairosAskSchema = z.object({
  askId: z.string().uuid(),
})

export type DismissKairosAskInput = z.infer<typeof dismissKairosAskSchema>
