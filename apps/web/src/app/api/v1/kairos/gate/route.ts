import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listHeldSpeaks, readKairosGate, toKairosGateView } from '@/lib/data/kairos-gate'
import { getKairosGateSchema } from '@/lib/data/validators/kairos-gate'
import { renderGateMarkdown } from '@/lib/kairos/moment/gate/render'

// Mirrors the get_kairos_gate MCP tool through the same validator + data fns
// (kairos-gate-parity.test.ts enforces this). Read-only and owner-scoped: the
// gate state and held rows are written only by the server.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const q = request.nextUrl.searchParams
    const parsed = getKairosGateSchema.safeParse({ format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const [state, held] = await Promise.all([readKairosGate(result.id), listHeldSpeaks(result.id)])
    const view = toKairosGateView(state, held)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderGateMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
