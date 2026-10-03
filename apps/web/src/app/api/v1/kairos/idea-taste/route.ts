import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readIdeaTaste } from '@/lib/data/idea-taste'
import { getKairosIdeaTasteSchema } from '@/lib/data/validators/kairos-idea-taste'
import { renderIdeaTasteMarkdown } from '@/lib/kairos/ideas/stepping/taste-render'

// Mirrors the get_kairos_idea_taste MCP tool through the same validator + data fn (kairos-idea-taste-parity.test.ts).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getKairosIdeaTasteSchema.safeParse({ format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const view = await readIdeaTaste(result.id)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderIdeaTasteMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
