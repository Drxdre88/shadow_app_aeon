import { renderTodaySection } from '@/lib/kairos/today-render'
import { listTodayEntries, todayWindow, toKairosTodayView } from './kairos-today'

// ─────────────────────────────────────────────────────────────────────────
// prepare_context "Today across channels" block (spec_one_mind). Lives in the
// data layer so MCP prepare_context and REST /api/v1/memories/context stay one
// shared function (memories-parity). Uses only the data-layer reader and the
// pure renderer — never lib/kairos/today (next/server, business code).
// Never throws: a failed read just drops the block.
// ─────────────────────────────────────────────────────────────────────────

export const TODAY_CONTEXT_SHARE = 0.15
const TODAY_CONTEXT_HOURS = 24
const TODAY_CONTEXT_LIMIT = 60
const CHARS_PER_TOKEN = 4

// Same flag as lib/kairos/today todayEnabled(): on unless KAIROS_TODAY === '0'.
function todayFlagOn(): boolean {
  return process.env.KAIROS_TODAY !== '0'
}

export async function loadTodayContextSection(userId: string, budgetTokens: number, now: Date = new Date()): Promise<string> {
  if (!todayFlagOn() || !userId) return ''
  const maxChars = Math.floor(budgetTokens * TODAY_CONTEXT_SHARE) * CHARS_PER_TOKEN
  if (maxChars <= 0) return ''
  try {
    const rows = await listTodayEntries(userId, { hours: TODAY_CONTEXT_HOURS, limit: TODAY_CONTEXT_LIMIT, now })
    if (rows.length === 0) return ''
    const { from, to } = todayWindow(TODAY_CONTEXT_HOURS, now)
    return renderTodaySection(
      { entries: rows.map(toKairosTodayView), from: from.toISOString(), to: to.toISOString() },
      { maxChars },
    )
  } catch (err) {
    console.warn('[prepareContext] today section failed', err instanceof Error ? err.message : err)
    return ''
  }
}
