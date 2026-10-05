import { listKairosPromises, toKairosPromiseView } from '@/lib/data/kairos-promises'
import { listKairosPromisesSchema } from '@/lib/data/validators/kairos-promises'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos promises — READ ONLY. Kairos makes promises only through the server
// (weekly review, goal approval); only the owner (web session or the
// operator Telegram chat) or the daily check closes them. No agent can keep,
// drop or move one. Mirrors GET /api/v1/kairos/promises
// (kairos-promises-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosPromiseTools: RegisterFn = (server) => {
  server.tool(
    'list_kairos_promises',
    'List Vorath\'s dated promises by P-number (P3 …): outcome, due date (London), status and how each is checked. scope "open" (default) or "all" to include the closed history. Read-only — only the owner can mark a promise kept, dropped or re-dated.',
    { scope: listKairosPromisesSchema.shape.scope.describe('"open" (default) or "all"') },
    { title: 'List Vorath Promises', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = listKairosPromisesSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const promises = (await listKairosPromises(uid, parsed.data)).map(toKairosPromiseView)
      return ok({ count: promises.length, promises })
    }
  )
}
