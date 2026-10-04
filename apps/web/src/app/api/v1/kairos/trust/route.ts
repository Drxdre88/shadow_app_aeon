import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readKairosTrust } from '@/lib/data/kairos-trust'
import { getKairosTrustSchema } from '@/lib/data/validators/kairos-trust'
import { renderTrustMarkdown } from '@/lib/kairos/trust/render'

// Mirrors the get_kairos_trust MCP tool through the same validator + data fn (kairos-trust-parity.test.ts).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getKairosTrustSchema.safeParse({ format: q.get('format') ?? undefined, area: q.get('area') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const view = await readKairosTrust(result.id, { area: parsed.data.area })
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderTrustMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
