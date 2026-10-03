import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listKairosAgenda, toKairosAgendaView } from '@/lib/data/kairos-agenda'
import { listKairosAgendaSchema } from '@/lib/data/validators/kairos-agenda'

// Mirrors the list_kairos_agenda MCP tool through the same validator + data
// fn. Read-only: no REST route can book, fire or cancel a Horae item.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const scope = request.nextUrl.searchParams.get('scope') ?? undefined
    const parsed = listKairosAgendaSchema.safeParse({ scope })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const items = (await listKairosAgenda(result.id, parsed.data)).map(toKairosAgendaView)
    return jsonData({ count: items.length, items })
  }),
  API_READ_LIMIT
)
