import { readRepoHandover } from '@/lib/data/repo-handover'
import { getRepoHandoverSchema } from '@/lib/data/validators/kairos-repo-handover'
import { renderRepoHandoverMarkdown } from '@/lib/kairos/repo-memory/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// Repo handover (Workforce) — READ ONLY, assembled on every read: recent
// agent sessions, open cards labelled for the repo, Vorath's open asks and
// promises, and the repo's lessons playbook. Never writes to a repo or board.
// Mirrors GET /api/v1/kairos/repo-handover (kairos-repo-handover-parity.test.ts).

export const registerKairosRepoHandoverTools: RegisterFn = (server) => {
  server.tool(
    'get_repo_handover',
    'Handover for one code repo before an agent starts work: a "Start here" paragraph (where things stand and the next obvious step), the latest 3 agent session summaries, up to 10 open cards labelled repo:<label> across your boards (board, column, priority, checklist progress), Vorath\'s open questions and promises (top 5 each), and the repo\'s lessons playbook with the session ids each lesson came from. Assembled fresh on every call. repo accepts a board label ("aeon", "repo:aeon") or a folder slug ("shadow_app_aeon"). format "json" (default) or "markdown". Read-only.',
    {
      repo: getRepoHandoverSchema.shape.repo.describe('Board label (e.g. "aeon" or "repo:aeon") or repo folder slug (e.g. "shadow_app_aeon")'),
      format: getRepoHandoverSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Repo Handover', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getRepoHandoverSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const handover = await readRepoHandover(uid, { repo: parsed.data.repo })
      if (!handover) return fail(`Repo not recognised: ${parsed.data.repo}`)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderRepoHandoverMarkdown(handover) })
      return ok(handover)
    }
  )
}
