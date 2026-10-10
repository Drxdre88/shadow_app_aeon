import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readKairosOwnerModel, toKairosOwnerModelView } from '@/lib/data/kairos-owner-model'
import { getKairosOwnerModelSchema } from '@/lib/data/validators/kairos-owner-model'
import { renderOwnerModelMarkdown } from '@/lib/kairos/owner-model/render'

// Mirrors the get_kairos_owner_model MCP tool through the same validator +
// data fns (kairos-owner-model-parity.test.ts enforces this). Read-only and
// owner-scoped: only the owner corrects the model (Telegram / web session).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const parsed = getKairosOwnerModelSchema.safeParse({ format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const view = toKairosOwnerModelView(await readKairosOwnerModel(result.id), { now: new Date() })
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderOwnerModelMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
