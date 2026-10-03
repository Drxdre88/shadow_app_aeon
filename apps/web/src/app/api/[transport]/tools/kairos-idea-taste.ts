import { readIdeaTaste } from '@/lib/data/idea-taste'
import { getKairosIdeaTasteSchema } from '@/lib/data/validators/kairos-idea-taste'
import { renderIdeaTasteMarkdown } from '@/lib/kairos/ideas/stepping/taste-render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// Kairos idea taste — READ ONLY. Recomputed from the owner's own idea decisions on every read.
// Mirrors GET /api/v1/kairos/idea-taste (kairos-idea-taste-parity.test.ts).

export const registerKairosIdeaTasteTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_idea_taste',
    'What Kairos has learned about which nightly ideas the owner takes up: accepted / dismissed / ignored counts over 90 days, per-feature leanings (area, kind of move, idea kind, leap, length) with lift, plain-language summary lines, the surprise-slot rule, the pure-novelty round schedule and the stepping-stone archive size. Agent-made accepts are not counted. format "json" (default) or "markdown". Read-only.',
    {
      format: getKairosIdeaTasteSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Kairos Idea Taste', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosIdeaTasteSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const view = await readIdeaTaste(uid)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderIdeaTasteMarkdown(view) })
      return ok(view)
    }
  )
}
