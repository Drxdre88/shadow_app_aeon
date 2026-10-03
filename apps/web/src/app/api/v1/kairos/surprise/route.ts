import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readKairosSurprise, toKairosSurpriseView } from '@/lib/data/kairos-surprise'
import { getKairosSurpriseSchema } from '@/lib/data/validators/kairos-surprise'
import { renderSurpriseMarkdown } from '@/lib/kairos/surprise/render'

// Mirrors the get_kairos_surprise MCP tool through the same validator + data
// fns (kairos-surprise-parity.test.ts enforces this). Read-only and
// owner-scoped: the ledger is written only by server-side producers.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getKairosSurpriseSchema.safeParse({ format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const view = toKairosSurpriseView(await readKairosSurprise(result.id), { now: new Date() })
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderSurpriseMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
