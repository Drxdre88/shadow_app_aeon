import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listLifeChapters, toLifeChapterView } from '@/lib/data/life-chapters'
import { getKairosLifeChaptersSchema, type LifeChapterView } from '@/lib/data/validators/kairos-life-chapters'
import { renderLifeChaptersMarkdown } from '@/lib/kairos/life-chapters/render'

// Mirrors the get_kairos_life_chapters MCP tool through the same validator +
// data fns (kairos-life-chapters-parity.test.ts enforces this). Read-only and
// owner-scoped: chapters are written only by the life_chapter thinking job.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getKairosLifeChaptersSchema.safeParse({
      month: q.get('month') ?? undefined,
      limit: q.get('limit') ?? undefined,
      format: q.get('format') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const rows = await listLifeChapters(result.id, { month: parsed.data.month, limit: parsed.data.limit })
    const chapters = rows.map(toLifeChapterView).filter((v): v is LifeChapterView => v !== null)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderLifeChaptersMarkdown(chapters) })
    return jsonData({ chapters })
  }),
  API_READ_LIMIT
)
