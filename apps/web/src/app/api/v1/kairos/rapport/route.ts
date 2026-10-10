import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readKairosRapport, toKairosRapportView } from '@/lib/data/kairos-rapport'
import { getKairosRapportSchema } from '@/lib/data/validators/kairos-rapport'
import { rapportModes } from '@/lib/kairos/rapport/flag'
import { renderRapportMarkdown } from '@/lib/kairos/rapport/render'

// Mirrors the get_kairos_rapport MCP tool through the same validator + data
// fns (kairos-rapport-parity.test.ts enforces this). Read-only and
// owner-scoped: rapport state is written only server-side.

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const parsed = getKairosRapportSchema.safeParse({ format: q.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const now = new Date()
    const view = toKairosRapportView(await readKairosRapport(result.id, now), { now, modes: rapportModes() })
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderRapportMarkdown(view) })
    return jsonData(view)
  }),
  API_READ_LIMIT
)
