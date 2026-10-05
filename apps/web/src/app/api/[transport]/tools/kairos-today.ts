import { listTodayEntries, todayWindow, toKairosTodayView } from '@/lib/data/kairos-today'
import { getKairosTodaySchema, TODAY_CHANNELS } from '@/lib/data/validators/kairos-today'
import { renderTodaySection } from '@/lib/kairos/today-render'
import type { RegisterFn } from './types'
import { getUserId, ok, fail } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos today — READ ONLY. The cross-channel "what happened today" log is
// written by the server alone (chat, Telegram, Triad, inbox, voice, MCP use);
// no tool can add, edit or delete an entry. Mirrors GET /api/v1/kairos/today
// (kairos-today-parity.test.ts).
// ─────────────────────────────────────────────────────────────────────────

const MARKDOWN_MAX_CHARS = 12_000

export const registerKairosTodayTools: RegisterFn = (server) => {
  server.tool(
    'get_kairos_today',
    'What happened across the channels of Vorath (formerly Kairos) in the last hours (web chat, Telegram, Triad, MCP use, voice, inbox, asks, his own notes): who said what, oldest first. speaker "owner" = the owner\'s own words; relayed=true = an agent reported them. hours 1-36 (default 24), optional channel filter, limit 1-200 (default 100), format "json" (default) or "markdown". Read-only.',
    {
      hours: getKairosTodaySchema.shape.hours.describe('Window in hours, 1-36 (default 24)'),
      channel: getKairosTodaySchema.shape.channel.describe(`One of ${TODAY_CHANNELS.join(', ')}`),
      limit: getKairosTodaySchema.shape.limit.describe('Max entries, 1-200 (default 100)'),
      format: getKairosTodaySchema.shape.format.describe('"json" (default) or "markdown"'),
    },
    { title: 'Get Vorath Today', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args, extra) => {
      const uid = getUserId(extra)
      const parsed = getKairosTodaySchema.safeParse(args)
      if (!parsed.success) return fail(parsed.error.issues[0].message)
      const now = new Date()
      const entries = (await listTodayEntries(uid, { ...parsed.data, now })).map(toKairosTodayView)
      const { from, to } = todayWindow(parsed.data.hours, now)
      const window = { count: entries.length, from: from.toISOString(), to: to.toISOString() }
      if (parsed.data.format === 'markdown') {
        const markdown = renderTodaySection({ entries, from: window.from, to: window.to }, { maxChars: MARKDOWN_MAX_CHARS })
        return ok({ ...window, markdown })
      }
      return ok({ ...window, entries })
    }
  )
}
