import { NextRequest } from 'next/server'
import { authenticateRequest, isApiUser, apiHandler, jsonData, jsonError } from '@/lib/api/auth'
import { vorathGuard } from '@/lib/api/vorath-guard'
import { withRateLimit, API_READ_LIMIT } from '@/lib/api/rateLimit'
import { listTodayEntries, todayWindow, toKairosTodayView } from '@/lib/data/kairos-today'
import { getKairosTodaySchema } from '@/lib/data/validators/kairos-today'
import { renderTodaySection } from '@/lib/kairos/today-render'

// Mirrors the get_kairos_today MCP tool through the same validator + data fns
// (kairos-today-parity.test.ts enforces this). Read-only and owner-scoped: no
// REST route can add, edit or delete a today entry.

const MARKDOWN_MAX_CHARS = 12_000

export const GET = withRateLimit(
  apiHandler(async (request: NextRequest) => {
    const result = await authenticateRequest(request)
    if (!isApiUser(result)) return result
    const denied = vorathGuard(result)
    if (denied) return denied

    const q = request.nextUrl.searchParams
    const parsed = getKairosTodaySchema.safeParse({
      hours: q.get('hours') ?? undefined,
      channel: q.get('channel') ?? undefined,
      limit: q.get('limit') ?? undefined,
      format: q.get('format') ?? undefined,
    })
    if (!parsed.success) return jsonError(parsed.error.issues[0].message, 400)

    const now = new Date()
    const entries = (await listTodayEntries(result.id, { ...parsed.data, now })).map(toKairosTodayView)
    const { from, to } = todayWindow(parsed.data.hours, now)
    const window = { count: entries.length, from: from.toISOString(), to: to.toISOString() }
    if (parsed.data.format === 'markdown') {
      const markdown = renderTodaySection({ entries, from: window.from, to: window.to }, { maxChars: MARKDOWN_MAX_CHARS })
      return jsonData({ ...window, markdown })
    }
    return jsonData({ ...window, entries })
  }),
  API_READ_LIMIT
)
