// Self-forecasting board (P3-2): a likely finish date for cards that already
// carry a due date or an estimate, worked out on read from the board's own
// recent column dwell and the cached Chronos computedEnd. Pure; never stored.

export type ForecastStatus = 'on_track' | 'at_risk' | 'late' | 'no_due_date'
export type ForecastConfidence = 'normal' | 'low'

export const FORECAST_WINDOW_DAYS = 30
export const AT_RISK_DAYS = 2
export const MIN_CONFIDENT_SAMPLES = 5

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const DONE_COLUMN_NAMES = new Set(['done', 'vault'])

export interface ForecastColumn {
  id: string
  name: string
  orderIndex: number
}

export interface ColumnDwell {
  column: string
  avgHours: number
  count: number
}

export interface ForecastTaskInput {
  id: string
  columnId: string | null
  endDate: Date | null
  estimateMinutes: number | null
  computedEnd: Date | null
}

export interface ForecastContext {
  columns: ForecastColumn[]
  dwell: ColumnDwell[]
  now: Date
}

export interface CardForecast {
  taskId: string
  forecastEnd: string
  dueDate: string | null
  status: ForecastStatus
  confidence: ForecastConfidence
  reason: string
  basis: {
    remainingHours: number
    columns: string[]
    samples: number
    computedEnd: string | null
    windowDays: number
  }
}

export function isDoneColumnName(name: string): boolean {
  return DONE_COLUMN_NAMES.has(name.trim().toLowerCase())
}

/** Columns a card still has to pass through before Done, starting with its own; empty when already done. */
export function remainingColumns(columns: ForecastColumn[], columnId: string | null): ForecastColumn[] {
  const ordered = [...columns].sort((a, b) => a.orderIndex - b.orderIndex)
  const doneIdx = ordered.findIndex((c) => isDoneColumnName(c.name))
  const open = doneIdx === -1 ? ordered : ordered.slice(0, doneIdx)
  if (columnId === null) return open
  const current = ordered.findIndex((c) => c.id === columnId)
  if (current === -1) return open
  if (doneIdx !== -1 && current >= doneIdx) return []
  return open.slice(current)
}

/** A date-only due date (stored at UTC midnight) counts until the end of that day. */
export function dueDeadline(endDate: Date): Date {
  const midnight = endDate.getUTCHours() === 0 && endDate.getUTCMinutes() === 0 && endDate.getUTCSeconds() === 0 && endDate.getUTCMilliseconds() === 0
  return midnight ? new Date(endDate.getTime() + DAY_MS - 1) : endDate
}

export function forecastStatus(forecast: Date, endDate: Date | null): ForecastStatus {
  if (!endDate) return 'no_due_date'
  const deadline = dueDeadline(endDate).getTime()
  if (forecast.getTime() > deadline) return 'late'
  if (deadline - forecast.getTime() <= AT_RISK_DAYS * DAY_MS) return 'at_risk'
  return 'on_track'
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function formatSpan(hours: number): string {
  if (hours < 24) return `about ${Math.max(1, Math.round(hours))} h`
  const days = Math.round((hours / 24) * 10) / 10
  return `about ${days} ${days === 1 ? 'day' : 'days'}`
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function statusPhrase(status: ForecastStatus, forecast: Date, endDate: Date | null): string {
  if (!endDate || status === 'no_due_date') return 'It has no due date, so this is a guide only.'
  const gapDays = Math.round(Math.abs(dueDeadline(endDate).getTime() - forecast.getTime()) / DAY_MS)
  if (status === 'late') return `That is ${gapDays < 1 ? 'just' : `about ${plural(gapDays, 'day')}`} after its due date (${formatDay(endDate)}).`
  if (status === 'at_risk') return `That is cutting it close to its due date (${formatDay(endDate)}).`
  return `That leaves room before its due date (${formatDay(endDate)}).`
}

/** The likely finish for one card, or null when it is done, undated and unestimated, or there is nothing to base a guess on. */
export function forecastCard(task: ForecastTaskInput, ctx: ForecastContext): CardForecast | null {
  if (!task.endDate && task.estimateMinutes == null) return null
  const path = remainingColumns(ctx.columns, task.columnId)
  if (path.length === 0) return null

  const byName = new Map(ctx.dwell.map((d) => [d.column, d]))
  const known = path.map((c) => ({ name: c.name, stat: byName.get(c.name) }))
  const remainingHours = known.reduce((sum, k) => sum + (k.stat?.avgHours ?? 0), 0)
  const samples = Math.min(...known.map((k) => k.stat?.count ?? 0))
  const anyHistory = known.some((k) => k.stat && k.stat.count > 0)
  if (!anyHistory && !task.computedEnd) return null

  const fromDwell = new Date(ctx.now.getTime() + remainingHours * HOUR_MS)
  const scheduleWins = task.computedEnd !== null && task.computedEnd.getTime() > fromDwell.getTime()
  const forecast = scheduleWins ? (task.computedEnd as Date) : fromDwell
  const status = forecastStatus(forecast, task.endDate)
  const confidence: ForecastConfidence = samples < MIN_CONFIDENT_SAMPLES ? 'low' : 'normal'

  const withHistory = known.filter((k) => k.stat && k.stat.count > 0)
  const missing = known.filter((k) => !k.stat || k.stat.count === 0).map((k) => k.name)
  const parts: string[] = []
  if (withHistory.length > 0) {
    const sat = withHistory.map((k) => `${k.name} (${formatSpan(k.stat!.avgHours)})`).join(', ')
    parts.push(`Based on how long cards sat in ${sat} over the last ${FORECAST_WINDOW_DAYS} days.`)
  }
  if (missing.length > 0) parts.push(`No recent history for ${missing.join(', ')}, so those count as no wait.`)
  if (scheduleWins) parts.push(`The schedule has it finishing later, on ${formatDay(task.computedEnd as Date)}, so that date is used.`)
  parts.push(statusPhrase(status, forecast, task.endDate))
  if (confidence === 'low') parts.push(`Only ${plural(samples, 'card')} moved through ${samples === 0 ? 'some of these columns' : 'these columns'} recently, so treat this as a rough guess.`)

  return {
    taskId: task.id,
    forecastEnd: forecast.toISOString(),
    dueDate: task.endDate ? task.endDate.toISOString() : null,
    status,
    confidence,
    reason: parts.join(' '),
    basis: {
      remainingHours: Math.round(remainingHours * 10) / 10,
      columns: path.map((c) => c.name),
      samples,
      computedEnd: task.computedEnd ? task.computedEnd.toISOString() : null,
      windowDays: FORECAST_WINDOW_DAYS,
    },
  }
}

export function forecastBoard(tasks: ForecastTaskInput[], ctx: ForecastContext): CardForecast[] {
  return tasks.flatMap((t) => {
    const f = forecastCard(t, ctx)
    return f ? [f] : []
  })
}
