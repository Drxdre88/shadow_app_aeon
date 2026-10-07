import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { readMorningCockpit } from '@/lib/data/morning-cockpit'
import { getMorningCockpitSchema } from '@/lib/data/validators/kairos-cockpit'
import { renderCockpitMarkdown } from '@/lib/kairos/cockpit/render'

// Mirrors the get_morning_cockpit MCP tool through the same validator + data fn (kairos-cockpit-parity.test.ts).

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result

    const parsed = getMorningCockpitSchema.safeParse({ format: request.nextUrl.searchParams.get('format') ?? undefined })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const cockpit = await readMorningCockpit(result.id)
    if (parsed.data.format === 'markdown') return jsonData({ markdown: renderCockpitMarkdown(cockpit) })
    return jsonData(cockpit)
  }),
  API_READ_LIMIT
)
