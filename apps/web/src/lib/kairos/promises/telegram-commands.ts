import { findOpenKairosPromiseBySeq } from '@/lib/data/kairos-promises'
import { londonDate } from '@/lib/kairos/daily-message-prompt'
import { closeKairosPromise, renegotiateKairosPromise } from './close'
import { dueWindow, formatDayMonth } from './rules'

// Owner promise commands from the operator's Telegram chat (Phase 2, Track B):
//   "P3 kept"     → kept       "drop P3" → dropped      "P3 by 20/10" → new due date
// A message is a command only when every non-empty line is one; anything
// else falls through to chat. Closes go through closeKairosPromise with the
// owner closer — the only way a promise closes from Telegram.

export type PromiseCommand =
  | { kind: 'kept'; seq: number }
  | { kind: 'drop'; seq: number }
  | { kind: 'move'; seq: number; day: number; month: number }

const KEPT_RE = /^p(\d{1,4})\s+kept$/i
const DROP_RE = /^drop\s+p(\d{1,4})$/i
const MOVE_RE = /^p(\d{1,4})\s+by\s+(\d{1,2})\/(\d{1,2})$/i

function parseLine(line: string): PromiseCommand | null {
  const s = line.trim().replace(/[.!]+$/, '').trim()
  let m = KEPT_RE.exec(s)
  if (m) return { kind: 'kept', seq: Number(m[1]) }
  m = DROP_RE.exec(s)
  if (m) return { kind: 'drop', seq: Number(m[1]) }
  m = MOVE_RE.exec(s)
  if (m) return { kind: 'move', seq: Number(m[1]), day: Number(m[2]), month: Number(m[3]) }
  return null
}

export function parsePromiseCommands(body: string): PromiseCommand[] | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const out: PromiseCommand[] = []
  for (const line of lines) {
    const cmd = parseLine(line)
    if (!cmd) return null
    out.push(cmd)
  }
  return out
}

function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return d.toISOString().slice(0, 10)
}

// dd/mm → YYYY-MM-DD in London: this year, or next year when the date has
// already passed (or is today) here. null = not a calendar date.
export function resolveDayMonth(day: number, month: number, now: Date): string | null {
  const today = londonDate(now)
  const year = Number(today.slice(0, 4))
  const thisYear = isoDate(year, month, day)
  if (thisYear && thisYear > today) return thisYear
  const nextYear = isoDate(year + 1, month, day)
  if (nextYear) return nextYear
  return thisYear
}

const dm = (c: { day: number; month: number }) => `${String(c.day).padStart(2, '0')}/${String(c.month).padStart(2, '0')}`

async function runCommand(userId: string, cmd: PromiseCommand, now: Date): Promise<string> {
  const label = `P${cmd.seq}`
  const promise = await findOpenKairosPromiseBySeq(userId, cmd.seq)
  if (!promise) return `${label}: no open promise`

  if (cmd.kind === 'kept' || cmd.kind === 'drop') {
    const verdict = cmd.kind === 'kept' ? 'kept' : 'dropped'
    const res = await closeKairosPromise(userId, promise.id, { kind: 'owner', via: 'telegram', verdict }, now)
    if (res.ok) return `✓ ${label} ${verdict}`
    return res.reason === 'already_closed' ? `${label}: already closed` : `${label}: no open promise`
  }

  const date = resolveDayMonth(cmd.day, cmd.month, now)
  if (!date) return `${label}: ${dm(cmd)} is not a date`
  const res = await renegotiateKairosPromise(userId, promise.id, date, { kind: 'owner', via: 'telegram' }, now)
  if (res.ok) return `✓ ${label} now due ${formatDayMonth(date)}`
  switch (res.reason) {
    case 'unchanged':
      return `${label}: already due ${formatDayMonth(date)}`
    case 'due_out_of_window': {
      const w = dueWindow(now)
      return `${label}: pick a date from ${formatDayMonth(w.earliest)} to ${formatDayMonth(w.latest)}`
    }
    case 'invalid_date':
      return `${label}: ${dm(cmd)} is not a date`
    case 'already_closed':
      return `${label}: already closed`
    default:
      return `${label}: no open promise`
  }
}

// True when the text was promise commands (handled and acked in one line).
export async function routePromiseCommands(
  userId: string,
  body: string,
  send: (text: string) => Promise<unknown>,
  now: Date = new Date(),
): Promise<boolean> {
  const commands = parsePromiseCommands(body)
  if (!commands) return false
  const acks: string[] = []
  for (const cmd of commands) {
    try {
      acks.push(await runCommand(userId, cmd, now))
    } catch (err) {
      console.error('[kairos:promise-commands] command failed', err)
      acks.push(`P${cmd.seq}: could not update — try again`)
    }
  }
  await send(acks.join(' · '))
  return true
}
