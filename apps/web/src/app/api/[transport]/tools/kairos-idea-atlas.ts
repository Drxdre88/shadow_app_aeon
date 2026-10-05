import { readKairosIdeaAtlas } from '@/lib/data/kairos-idea-atlas'
import { listActiveDominions } from '@/lib/data/idea-inputs'
import { getKairosIdeaAtlasSchema } from '@/lib/data/validators/kairos-idea-atlas'
import { renderIdeaAtlasMarkdown, toIdeaAtlasView } from '@/lib/kairos/ideas/atlas/view'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos idea atlas — READ ONLY. Which kinds of idea (question, experiment,
// reframe, make, ritual × near/far leap) Kairos has found per life area, and
// the best idea holding each cell. Written only by the nightly idea judge;
// no tool can change it. Mirrors GET /api/v1/kairos/idea-atlas
// (kairos-idea-atlas-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosIdeaAtlasTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_idea_atlas',
    'Vorath\'s idea atlas: for each active Dominion (plus cross-cutting), which kinds of idea (question, experiment, reframe, make, ritual) at which leap (near/far) he has found, the idea holding each cell, coverage, never-tried cells and the last targets. format "json" (default) or "markdown". Read-only.',
    {
      format: getKairosIdeaAtlasSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Vorath Idea Atlas', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosIdeaAtlasSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const [state, dominions] = await Promise.all([readKairosIdeaAtlas(uid), listActiveDominions(uid)])
      const view = toIdeaAtlasView(state, dominions)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderIdeaAtlasMarkdown(view) })
      return ok(view)
    }
  )
}
