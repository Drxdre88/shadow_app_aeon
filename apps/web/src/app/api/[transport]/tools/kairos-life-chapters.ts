import { listLifeChapters, toLifeChapterView } from '@/lib/data/life-chapters'
import { getKairosLifeChaptersSchema, type LifeChapterView } from '@/lib/data/validators/kairos-life-chapters'
import { renderLifeChaptersMarkdown } from '@/lib/kairos/life-chapters/render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos life chapters — READ ONLY. The monthly chapter of Kairos's own story
// (turning points, what changed, what is still open), each item citing the
// ids it rests on. Written only by the life_chapter thinking job; no tool can
// write or edit one. Mirrors GET /api/v1/kairos/life-chapters
// (kairos-life-chapters-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

export const registerKairosLifeChapterTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_life_chapters',
    'Vorath’s monthly life chapters, newest first: title, summary, turning points (before/after), what changed and what is still open, each with the ids it cites. month "YYYY-MM" narrows to one chapter; limit 1–12 (default 3); format "json" (default) or "markdown". Read-only.',
    {
      month: getKairosLifeChaptersSchema.shape.month.describe('"YYYY-MM" — one month only (optional)'),
      limit: getKairosLifeChaptersSchema.shape.limit.describe('How many chapters, 1–12 (default 3)'),
      format: getKairosLifeChaptersSchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Vorath Life Chapters', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosLifeChaptersSchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const rows = await listLifeChapters(uid, { month: parsed.data.month, limit: parsed.data.limit })
      const chapters = rows.map(toLifeChapterView).filter((v): v is LifeChapterView => v !== null)
      if (parsed.data.format === 'markdown') return ok({ markdown: renderLifeChaptersMarkdown(chapters) })
      return ok({ chapters })
    }
  )
}
