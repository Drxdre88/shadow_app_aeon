import { z } from 'zod'
import { runKairosAsk, answerKairosAsk } from '@/lib/kairos/ask'
import { getPendingKairosAsk } from '@/lib/data/ask'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Asks — MCP tools. Proactive-question layer above Aether.
//
// run_kairos_ask: select + persist the single best question from the latest
//   Aether, or return the reason for silence (cadence / no signal / pending).
//   This is the trigger seam any scheduler/runtime wires to.
//
// get_pending_kairos_ask: read the current unanswered question without
//   selecting a new one — the read seam for delivery surfaces.
//
// answer_kairos_ask: record the operator's answer as a reflection anchored
//   to the question's Dominion, then archive the question memory.
//
// These tools are synthesis-surface only — NOT part of the Gantt MCP/REST
// parity invariant (confirmed: gantt-parity.test.ts only reads gantt.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerAskTools: RegisterFn = (server) => {
  server.tool(
    'run_kairos_ask',
    'Select and persist the single best proactive question from the latest Aether synthesis. Returns the pending question if one already exists (never stacks two). Returns a silent/reason object if cadence window hasn\'t elapsed or there is no qualifying signal. Call this from a Claude Code session or a future scheduler to drive the Kairos proactive-question loop.',
    {},
    async (_args, extra) => {
      const uid = getUserId(extra)
      const result = await runKairosAsk(uid)

      if (result.asked) {
        return ok({
          asked: true,
          question: {
            id: result.question.id,
            title: result.question.title,
            dominionId: result.question.dominionId,
            askedAt: result.question.kairosAsk.askedAt,
            sourceMemoryIds: result.question.kairosAsk.sourceMemoryIds,
          },
        })
      }

      if (result.reason === 'pending') {
        return ok({
          asked: false,
          reason: 'pending',
          pending: {
            id: result.pending.id,
            title: result.pending.title,
            dominionId: result.pending.dominionId,
            askedAt: result.pending.kairosAsk.askedAt,
          },
        })
      }

      return ok({ asked: false, reason: result.reason })
    },
  )

  server.tool(
    'get_pending_kairos_ask',
    'Read the current pending (unanswered) Kairos question WITHOUT triggering a new selection. Returns { pending: null } when Kairos is not waiting on anything. Use this from a delivery surface (the Kairos view, a notification poller, a session opener) to check whether the operator owes Kairos an answer.',
    {},
    async (_args, extra) => {
      const uid = getUserId(extra)
      const pending = await getPendingKairosAsk(uid)
      if (!pending) return ok({ pending: null })
      return ok({
        pending: {
          id: pending.id,
          question: pending.title,
          dominionId: pending.dominionId,
          askedAt: pending.kairosAsk.askedAt,
          sourceThoughtId: pending.kairosAsk.sourceThoughtId,
          sourceMemoryIds: pending.kairosAsk.sourceMemoryIds,
          aetherMemoryId: pending.kairosAsk.aetherMemoryId,
        },
      })
    },
  )

  server.tool(
    'answer_kairos_ask',
    'Record the operator\'s answer to a pending Kairos question. Writes a reflection anchored to the question\'s Dominion (or a floating reflection if the question has no Dominion), then archives the question memory. Use list_dominions to find a dominionId override if needed.',
    {
      questionMemoryId: z.string().uuid().describe('ID of the pending kairos-ask memory to answer'),
      answer: z.string().trim().min(1).max(10000).describe('The operator\'s answer — markdown supported. Plain text is fine.'),
      dominionId: z.string().uuid().optional().describe('Override the Dominion to anchor the answer reflection. Defaults to the question\'s Dominion.'),
    },
    async (args, extra) => {
      const uid = getUserId(extra)
      const result = await answerKairosAsk(
        uid,
        args.questionMemoryId,
        args.answer,
        args.dominionId,
      )

      if ('error' in result) {
        if (result.error === 'not_found') return notFound('Kairos question')
        return notFound('Dominion')
      }

      return ok({ reflectionId: result.reflectionId })
    },
  )
}
