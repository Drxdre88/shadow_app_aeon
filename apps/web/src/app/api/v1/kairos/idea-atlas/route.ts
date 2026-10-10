import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readKairosIdeaAtlas } from '@/lib/data/kairos-idea-atlas'
import { listActiveDominions } from '@/lib/data/idea-inputs'
import { getKairosIdeaAtlasSchema } from '@/lib/data/validators/kairos-idea-atlas'
import { renderIdeaAtlasMarkdown, toIdeaAtlasView } from '@/lib/kairos/ideas/atlas/view'

// Mirrors the get_kairos_idea_atlas MCP tool through the same validator + data
// fns (kairos-idea-atlas-parity.test.ts enforces this). Read-only and
// owner-scoped: the atlas is written only by the nightly idea judge.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const parsed = getKairosIdeaAtlasSchema.safeParse({ format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const [state, dominions] = await Promise.all([readKairosIdeaAtlas(result.id), listActiveDominions(result.id)])
    const view = toIdeaAtlasView(state, dominions)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderIdeaAtlasMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
