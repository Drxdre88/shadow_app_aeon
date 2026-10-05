import { z } from 'zod'
import { runKairosAsk, answerKairosAsk, dismissKairosAsk } from '@/lib/kairos/ask'
import { getPendingKairosAsk, listOpenKairosAsks, toOpenKairosAskView } from '@/lib/data/ask'
import { dismissKairosAskSchema, listOpenKairosAsksSchema } from '@/lib/data/validators/kairos-asks'
import type { RegisterFn } from './types'
import { getUserId, ok, notFound, fail } from './types'

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
//   to the question's Dominion, then archive the question memory. Any open
//   ask can be answered by id, not just the newest.
//
// list_open_kairos_asks / dismiss_kairos_ask: the Q-numbered open-question
//   backlog the 06:00 message lists, and the operator's "skip". These two
//   mirror /api/v1/kairos/asks (kairos-asks-parity.test.ts); the rest are
//   synthesis-surface only.
//
// Not part of the Gantt MCP/REST parity invariant (gantt-parity.test.ts only
// reads gantt.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerAskTools: RegisterFn = (server) => {
  server.tool(
    'run_kairos_ask',
    'Select and persist the single best proactive question from the latest Aether synthesis. Returns the pending question if one already exists (never stacks two). Returns a silent/reason object if cadence window hasn\'t elapsed or there is no qualifying signal. Call this from a Claude Code session or a future scheduler to drive the Vorath proactive-question loop.',
    {},
    { title: 'Run Vorath Ask', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    'Read the newest open (unanswered) Vorath question WITHOUT triggering a new selection. Returns { pending: null } when Vorath is not waiting on anything. Several questions can be open at once — use list_open_kairos_asks for the full numbered backlog.',
    {},
    { title: 'Get Pending Vorath Ask', readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    'Record the operator\'s answer to a pending Vorath question. Writes a reflection anchored to the question\'s Dominion (or a floating reflection if the question has no Dominion), then archives the question memory. Use list_dominions to find a dominionId override if needed.',
    {
      questionMemoryId: z.string().uuid().describe('ID of the pending kairos-ask memory to answer'),
      answer: z.string().trim().min(1).max(10000).describe('The operator\'s answer — markdown supported. Plain text is fine.'),
      dominionId: z.string().uuid().optional().describe('Override the Dominion to anchor the answer reflection. Defaults to the question\'s Dominion.'),
    },
    { title: 'Answer Vorath Ask', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const result = await answerKairosAsk(
        uid,
        args.questionMemoryId,
        args.answer,
        args.dominionId,
      )

      if ('error' in result) {
        if (result.error === 'not_found') return notFound('Vorath question')
        return notFound('Dominion')
      }

      return ok({ reflectionId: result.reflectionId })
    },
  )

  server.tool(
    'list_open_kairos_asks',
    'List every open (unanswered, not expired, not dismissed) Vorath question, oldest first, each with its stable number (label "Q12"). This is the backlog the 06:00 morning message lists; answer one with answer_kairos_ask (by id) or drop it with dismiss_kairos_ask.',
    {},
    { title: 'List Open Vorath Asks', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listOpenKairosAsksSchema.safeParse(args ?? {})
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const asks = (await listOpenKairosAsks(uid)).map(toOpenKairosAskView)
      return ok({ count: asks.length, asks })
    },
  )

  server.tool(
    'dismiss_kairos_ask',
    'Dismiss (skip) one open Vorath question: it leaves the backlog, is archived with status "dismissed", and — unlike expiry — records no negative outcome. Use only on the operator\'s request (e.g. "skip Q12").',
    {
      askId: z.string().uuid().describe('ID of the open kairos-ask memory (from list_open_kairos_asks)'),
    },
    { title: 'Dismiss Vorath Ask', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = dismissKairosAskSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const result = await dismissKairosAsk(uid, parsed.data.askId)
      if ('error' in result) return notFound('Open Vorath question')
      return ok({ dismissed: true, id: result.id })
    },
  )
}
