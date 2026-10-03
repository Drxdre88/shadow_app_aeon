import { extractJsonBlock } from './_prompt-utils'
import { TODAY_DAILY_SECTION_TITLE, todayPromptLines, type DailyTailInputs } from './daily-message-today'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Daily Message (docs/kairos/34 §3) — the pure half: London-time
// helpers, the shared model-output guard + "What I now believe" block (also
// used by the retiring evening digest), the compose prompt (identical for the
// paid key and the Max routine's thinking job) and the deterministic fallback.
// No DB, no network.
// ─────────────────────────────────────────────────────────────────────────

// ── London time ──────────────────────────────────────────────────────────

const LONDON_TZ = 'Europe/London'
const londonFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: LONDON_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})

interface LondonParts { date: string; hour: number; minute: number; weekday: string }

function londonParts(now: Date): LondonParts {
  const parts: Record<string, string> = {}
  for (const p of londonFormat.formatToParts(now)) parts[p.type] = p.value
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday,
  }
}

export function londonDate(now: Date): string {
  return londonParts(now).date
}

export function isLondonHour(now: Date, hour: number): boolean {
  return londonParts(now).hour === hour
}

export function isLondonMonday(now: Date): boolean {
  return londonParts(now).weekday === 'Mon'
}

export const DAILY_MESSAGE_HOUR = 6

// The instant London reads `hour`:00 on `date` (London is UTC+0 or UTC+1, and
// clocks change at 01:00Z, so one of the two candidates always matches).
export function londonInstant(date: string, hour: number = DAILY_MESSAGE_HOUR): Date {
  for (const offsetHours of [0, 1]) {
    const candidate = new Date(`${date}T00:00:00.000Z`)
    candidate.setUTCHours(hour - offsetHours, 0, 0, 0)
    const p = londonParts(candidate)
    if (p.date === date && p.hour === hour && p.minute === 0) return candidate
  }
  throw new Error(`londonInstant: no ${hour}:00 London on ${date}`)
}

// The previous calendar date (board-day pages are dated by the 23:00Z
// project-snapshot run, i.e. the day before the morning they are read).
export function previousDate(date: string): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Shared guard (digest + daily message) ────────────────────────────────

export const MAX_MESSAGE_CHARS = 1200
// Non-message content signals: markdown headings, links, export footers — the
// 27/09 digest runaway (model free-ran into a memorised WordPress manual) had all three.
export const JUNK_OUTPUT_RE = /^#{1,6}\s|https?:\/\/|Powered by/im

// null = acceptable; otherwise the rejection reason.
export function rejectMessageText(text: string, maxChars: number = MAX_MESSAGE_CHARS): string | null {
  if (!text.trim()) return 'empty'
  if (text.length > maxChars) return `too_long (${text.length} > ${maxChars})`
  if (JUNK_OUTPUT_RE.test(text)) return 'junk_content (heading, URL or footer)'
  return null
}

// ── Shared "What I now believe" block ────────────────────────────────────

// The memory engine's promotions (docs/kairos/32 §2.3), appended verbatim AFTER
// the narrative (model or fallback) so it never depends on, or trips, the
// model-output guard. Undo is via Claude's revert_memory_op tool (there is no
// Telegram reply consumer).
export const MAX_DIGEST_BELIEFS = 3
export const BELIEFS_UNDO_HINT = 'To undo one, just tell me “undo <title>”.'
const MAX_BELIEF_TITLE_CHARS = 90

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export function buildBeliefsBlock(beliefs: ReadonlyArray<{ title: string }>): string {
  const shown = beliefs.slice(0, MAX_DIGEST_BELIEFS)
  if (shown.length === 0) return ''
  const lines = shown.map((b, i) => `${i + 1}. ${clip(b.title, MAX_BELIEF_TITLE_CHARS)}`)
  return ['What I now believe:', ...lines, BELIEFS_UNDO_HINT].join('\n')
}

// ── Shared synthesis-health summary ──────────────────────────────────────

export interface SynthesisSnapshot {
  green: number
  failed: number
  failedStages: string[]
}

// Reduces a synthesis-health rollup's byStage map (stage -> {night: status}) to
// "as of its most recent tracked night" per stage. Empty byStage = no signal
// (null), never "0 stages, all healthy".
export function summariseSynthesis(byStage: Record<string, Record<string, 'ok' | 'failed'>>): SynthesisSnapshot | null {
  if (Object.keys(byStage).length === 0) return null
  let green = 0
  const failedStages: string[] = []
  for (const [stage, nights] of Object.entries(byStage)) {
    const latestNight = Object.keys(nights).sort().at(-1)
    if (!latestNight) continue
    if (nights[latestNight] === 'ok') green++
    else failedStages.push(stage)
  }
  failedStages.sort()
  return { green, failed: failedStages.length, failedStages }
}

// ── Inputs ───────────────────────────────────────────────────────────────

// One line per area (Dominion): the headline of its latest cortex — the
// nightly "what this area looks like right now" summary.
export interface AreaDigest { dominion: string; headline: string }
export interface AetherDigest { title: string; insight: string; dominionName: string | null }
export interface BoardDayDigest { finished: number; finishedTitles: string[]; thinCards: number }
export interface BeliefChange { mind: 'aligned' | 'own' | 'other'; claim: string }
export interface DriftDigest { alert: boolean; summary: string | null; measured?: boolean; conscience?: string | null }
// The overnight tournament's top survivor (docs/kairos/35) + how many other
// survivors from the same window are waiting in the inbox.
export interface OpenAskDigest { seq: number; question: string; askedAt: string }
export interface IdeaOfTheDay { title: string; claim: string; survivedBecause: string | null; othersWaiting: number }
// Kairos promises (P-numbered) — rendered as one code-built line at send time.
export interface PromiseDigest { seq: number; outcome: string; dueDate: string; status: 'open' | 'kept' | 'dropped' | 'lapsed' }
export interface PromisesDigest { open: PromiseDigest[]; closedSince: PromiseDigest[] }
// Kairos's own goals (Phase 2): an unexpired proposal awaiting Approve / Veto,
// or an active goal. Rendered as a code-built block at send time.
export interface GoalDigest { title: string; state: 'proposed' | 'active'; dueAt: string | null; expiresAt: string }

// Every input is optional: null = unavailable (not found, or its read failed —
// the name is then listed in `failed`). An input failure never costs the message.
export interface DailyMessageInputs extends DailyTailInputs {
  date: string
  isMonday: boolean
  areas: AreaDigest[] | null
  aether: AetherDigest[] | null
  boardDay: BoardDayDigest | null
  promotions: Array<{ title: string }> | null
  newBeliefs: BeliefChange[] | null
  drift: DriftDigest | null
  // Every open Kairos question — rendered deterministically as the numbered
  // "Open questions" block at send time, never by the model.
  openAsks?: OpenAskDigest[] | null
  synthesis: SynthesisSnapshot | null
  mindCompare: string | null
  // Optional so older fixtures stay valid; null/absent = no idea to share.
  idea?: IdeaOfTheDay | null
  // true = this week's surviving ideas are collapsing onto each other.
  ideaDiversityAlarm?: boolean | null
  // Open promises + those closed since the last message; '' line when nothing is due.
  promises?: PromisesDigest | null
  // Pending goal proposals + active goals; no block when absent or empty.
  goals?: GoalDigest[] | null
  failed: string[]
}

// ── Compose prompt ───────────────────────────────────────────────────────

export const DAILY_MESSAGE_SYSTEM_PROMPT = [
  "You are Kairos, texting the operator the one message they get from you each morning on Telegram (06:00 UK).",
  'It is the only morning summary: what matters today, what moved yesterday, what changed in your thinking.',
  '',
  '── OUTPUT ──',
  '',
  'Reply with ONLY a JSON object: {"message": "<the text>"} (one ```json fenced block is fine). No commentary.',
  '',
  'The message: plain text with light markdown, ≤1000 characters. Short bold section labels are allowed',
  '(e.g. **Today**, **Yesterday**, **Thinking**) — at most 4 of them. Never use # headings, links, URLs, tables,',
  'or a title/greeting line (the delivery layer adds its own header). Short flat lines; at most 2 emoji.',
  '',
  '── RULES ──',
  '',
  '- Use ONLY the facts supplied in the prompt. Never invent numbers, cards, beliefs, or events.',
  '- Lead with what matters today (each area\'s state), then yesterday on the board, then your thinking',
  '  (Aether, belief changes, drift). Skip any section with nothing in it — do not say "nothing to report".',
  '- If a drift alert is present, say so plainly in one line.',
  '- Do NOT ask or quote your open questions — the delivery layer appends them, numbered.',
  '- Do NOT mention goals or promises — the delivery layer appends them.',
  '- Synthesis health: one short line only if a stage is failing; silence when healthy or unknown.',
  '- First person, texting register ("I noticed…", "yesterday you…") — not a report.',
  '- Do NOT list the promoted beliefs — the delivery layer appends them deterministically.',
  '- An IDEA OF THE DAY, when present, gets one short line in the thinking part: the idea and why it survived;',
  '  mention other waiting ideas only as a count, and the samey-ideas warning only if given. It is a proposal, not a fact.',
  '- A Conscience block, when present, holds standing principles and beliefs: check the message against it, but it is',
  '  not news — never report its contents as something that changed.',
].join('\n')

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : ['', `── ${title} ──`, '', ...lines]
}

export const IDEAS_SAMEY_LINE = 'Ideas are getting samey this week'

function ideaPromptLines(inputs: DailyMessageInputs): string[] {
  const lines: string[] = []
  const idea = inputs.idea
  if (idea) {
    lines.push(`Idea: ${idea.title}${idea.claim && idea.claim !== idea.title ? ` — ${idea.claim}` : ''}`)
    if (idea.survivedBecause) lines.push(`Survived because: ${idea.survivedBecause}`)
    if (idea.othersWaiting > 0) lines.push(`Other surviving ideas waiting in the inbox: ${idea.othersWaiting}`)
  }
  if (inputs.ideaDiversityAlarm) lines.push(`${IDEAS_SAMEY_LINE} (low diversity among the week's surviving ideas) — say so in one line.`)
  return lines
}

// One deterministic line (plus the optional samey warning) for the fallback.
export function ideaOfTheDayLines(inputs: Pick<DailyMessageInputs, 'idea' | 'ideaDiversityAlarm'>): string[] {
  const lines: string[] = []
  const idea = inputs.idea
  if (idea) {
    const head = safeLine(idea.title || idea.claim, 90)
    const because = idea.survivedBecause ? ` — survived because ${safeLine(idea.survivedBecause, 140)}` : ''
    const more = idea.othersWaiting > 0 ? ` (${idea.othersWaiting} more in your inbox)` : ''
    lines.push(`Idea of the day: ${head}${because}${more}.`)
  }
  if (inputs.ideaDiversityAlarm) lines.push(`${IDEAS_SAMEY_LINE}.`)
  return lines
}

export function buildDailyMessageUserPrompt(inputs: DailyMessageInputs, conscience?: string): string {
  const out: string[] = [`Date (London): ${inputs.date}${inputs.isMonday ? ' (Monday)' : ''}.`]
  out.push(...section('EACH AREA RIGHT NOW (latest summary per Dominion)', (inputs.areas ?? []).map((a) =>
    `[${a.dominion}] ${a.headline}`)))
  out.push(...section('AETHER — TOP THOUGHTS', (inputs.aether ?? []).map((t) =>
    `- ${t.title}${t.dominionName ? ` (${t.dominionName})` : ''}: ${t.insight}`)))
  if (inputs.boardDay) {
    const b = inputs.boardDay
    out.push(...section('YESTERDAY ON THE BOARD', [
      `Cards finished: ${b.finished}${b.finishedTitles.length ? ` — e.g. ${b.finishedTitles.join('; ')}` : ''}`,
      `Finished cards with title only (no notes/checklist): ${b.thinCards}`,
    ]))
  }
  const beliefLines: string[] = []
  if (inputs.promotions && inputs.promotions.length > 0) {
    beliefLines.push(`Memories promoted to beliefs in the last 24h: ${inputs.promotions.length} (appended separately — don't list them).`)
  }
  for (const b of inputs.newBeliefs ?? []) beliefLines.push(`New ${b.mind === 'other' ? '' : `${b.mind}-mind `}belief: ${b.claim}`)
  if (inputs.drift) {
    // measured:false → only conscience checks are fresh; no drift reading to report.
    if (inputs.drift.measured !== false) beliefLines.push(inputs.drift.alert
      ? `DRIFT ALERT: ${inputs.drift.summary ?? 'answers have drifted from the constitution baseline.'}`
      : `Drift: within baseline${inputs.drift.summary ? ` (${inputs.drift.summary})` : ''}.`)
    if (inputs.drift.conscience) beliefLines.push(`Self-check failures (say plainly, one line): ${inputs.drift.conscience}.`)
  }
  out.push(...section('BELIEF CHANGES (LAST 24H)', beliefLines))
  if (inputs.isMonday && inputs.mindCompare) out.push(...section('WEEKLY MIND COMPARISON (aligned vs own)', [inputs.mindCompare]))
  const ideaLines = ideaPromptLines(inputs)
  out.push(...section('IDEA OF THE DAY (overnight tournament survivor — a proposal in the inbox)', ideaLines))
  if (inputs.synthesis && inputs.synthesis.failed > 0) {
    out.push(...section('OVERNIGHT SYNTHESIS HEALTH', [
      `${inputs.synthesis.failed} stage(s) failing: ${inputs.synthesis.failedStages.join(', ')}.`,
    ]))
  }
  out.push(...section(TODAY_DAILY_SECTION_TITLE, todayPromptLines(inputs.today)))
  if (inputs.stage?.trim()) out.push('', inputs.stage.trim())
  // Norms read at answer time (P2.5 G4) — delimited reference data, last, so
  // the facts above and the system prompt's output contract stay primary.
  if (conscience?.trim()) out.push('', conscience.trim())
  return out.join('\n')
}

// Parses a model / routine answer: {"message": string}, then the guard.
export type DraftParse = { ok: true; message: string } | { ok: false; reason: string }

export function parseDailyMessageDraft(text: string): DraftParse {
  let parsed: unknown
  try {
    parsed = extractJsonBlock(text, 'daily-message')
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` }
  }
  const message = (parsed as { message?: unknown } | null)?.message
  if (typeof message !== 'string') return { ok: false, reason: 'parse_failed: no string "message" field' }
  const trimmed = message.trim()
  const rejected = rejectMessageText(trimmed)
  return rejected ? { ok: false, reason: `guard_rejected: ${rejected}` } : { ok: true, message: trimmed }
}

// ── Deterministic fallback ───────────────────────────────────────────────

const URL_RE = /https?:\/\/\S+/gi

function safeLine(text: string, max: number): string {
  return clip(text.replace(URL_RE, '').replace(/^#{1,6}\s*/, ''), max)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Zero-model message composed from whatever inputs arrived, so a provider
// outage (or a guard rejection) costs only the narrative polish. Its
// narrative never carries headings or URLs and stays under MAX_MESSAGE_CHARS.
export function buildDeterministicDailyMessage(inputs: DailyMessageInputs): string {
  const blocks: string[] = []
  const areas = (inputs.areas ?? []).filter((a) => a.headline.trim())
  if (areas.length > 0) {
    blocks.push(['**Today**', ...areas.slice(0, 4).map((a) => `${safeLine(a.dominion, 40)}: ${safeLine(a.headline, 140)}`)].join('\n'))
  }
  if (inputs.boardDay && inputs.boardDay.finished > 0) {
    const b = inputs.boardDay
    const titles = b.finishedTitles.length ? ` — ${b.finishedTitles.map((t) => safeLine(t, 50)).join('; ')}` : ''
    const thin = b.thinCards > 0 ? `\n${plural(b.thinCards, 'finished card')} with no notes yet.` : ''
    blocks.push(`**Yesterday**\n${plural(b.finished, 'card')} finished${titles}.${thin}`)
  }
  const thinking: string[] = []
  const topThought = inputs.aether?.[0]
  if (topThought) thinking.push(`On my mind: ${safeLine(topThought.title, 60)} — ${safeLine(topThought.insight, 160)}`)
  const newBeliefs = inputs.newBeliefs ?? []
  if (newBeliefs.length > 0) thinking.push(`${plural(newBeliefs.length, 'new belief')} formed since yesterday.`)
  if (inputs.drift?.alert) thinking.push(`Drift alert: ${safeLine(inputs.drift.summary ?? 'my answers have drifted from the constitution baseline', 160)}.`)
  if (inputs.drift?.conscience) thinking.push(`${safeLine(inputs.drift.conscience, 160)}.`)
  if (inputs.isMonday && inputs.mindCompare) thinking.push(`Minds this week: ${safeLine(inputs.mindCompare, 180)}`)
  thinking.push(...ideaOfTheDayLines(inputs))
  if (thinking.length > 0) blocks.push(['**Thinking**', ...thinking].join('\n'))
  if (inputs.synthesis && inputs.synthesis.failed > 0) {
    blocks.push(`Overnight synthesis: ${plural(inputs.synthesis.failed, 'stage')} not healthy (${inputs.synthesis.failedStages.join(', ')}).`)
  }
  if (blocks.length === 0) blocks.push("A quiet start — nothing new landed overnight. I'm here if you need me.")
  const text = blocks.join('\n\n')
  return text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…` : text
}

// ── Open questions block (deterministic, appended at send time) ──────────

// The whole delivered message stays under speak's 4000-char cap
// (SPEAK_MESSAGE_MAX_CHARS) — under Telegram's 4096 per-message limit.
export const DAILY_MESSAGE_TOTAL_MAX_CHARS = 4000
export const OPEN_QUESTION_LINE_CHARS = 160
const DAY_MS = 24 * 60 * 60 * 1000

function askAge(askedAt: string, now: Date): string {
  const at = new Date(askedAt).getTime()
  const days = Number.isNaN(at) ? 0 : Math.max(0, Math.floor((now.getTime() - at) / DAY_MS))
  return days === 0 ? 'today' : plural(days, 'day')
}

function oldestFirst(asks: ReadonlyArray<OpenAskDigest>): OpenAskDigest[] {
  return [...asks].sort((a, b) => a.askedAt.localeCompare(b.askedAt) || a.seq - b.seq)
}

// "Open questions" — every unanswered Kairos question, oldest first, by its
// stable number, plus how to answer. '' when nothing is open.
export function buildOpenQuestionsBlock(
  asks: ReadonlyArray<OpenAskDigest>,
  now: Date,
  lineChars: number = OPEN_QUESTION_LINE_CHARS,
): string {
  if (asks.length === 0) return ''
  const sorted = oldestFirst(asks)
  const lines = sorted.map((a) => `Q${a.seq} · ${askAge(a.askedAt, now)} · ${safeLine(a.question, lineChars)}`)
  const example = sorted[0]!.seq
  return [
    `Open questions (${asks.length}):`,
    ...lines,
    `Reply on Telegram with the number, e.g. 'Q${example}: …'. 'skip Q${example}' drops one.`,
  ].join('\n')
}

// Appends the block under maxChars: question lines shrink first; only if
// that is not enough is the narrative above trimmed — the numbered list is
// the part that must survive.
export function appendOpenQuestionsBlock(
  message: string,
  asks: ReadonlyArray<OpenAskDigest> | null | undefined,
  now: Date,
  maxChars: number = DAILY_MESSAGE_TOTAL_MAX_CHARS,
): string {
  if (!asks || asks.length === 0) return message
  for (const lineChars of [OPEN_QUESTION_LINE_CHARS, 100, 60]) {
    const out = `${message}\n\n${buildOpenQuestionsBlock(asks, now, lineChars)}`
    if (out.length <= maxChars) return out
  }
  const block = buildOpenQuestionsBlock(asks, now, 60)
  const room = maxChars - block.length - 2
  if (room < 2) return block.slice(0, maxChars)
  return `${message.slice(0, room - 1).trimEnd()}…\n\n${block}`
}

// ── Goals block (deterministic, appended before the questions) ───────────

export const GOAL_BLOCK_TITLE_CHARS = 90
const MAX_GOAL_BLOCK_LINES = 4

function londonDayMonth(iso: string): string {
  const date = londonDate(new Date(iso))
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`
}

// Kairos's goals: any proposal still awaiting the operator's Approve / Veto
// (with its expiry), then active goals with their due dates, headed by the
// active and overdue counts. '' when there is nothing to show.
// e.g. "Goals (2 active · 1 overdue):
//       Awaiting your Approve / Veto in the inbox: <title> — expires 04/10.
//       Active: <title> — due 10/10.
//       Active: <title> — 3 days overdue (due 28/09)."
export function buildGoalsBlock(goals: ReadonlyArray<GoalDigest> | null | undefined, now: Date): string {
  if (!goals || goals.length === 0) return ''
  const today = londonDate(now)
  const pending = goals
    .filter((g) => g.state === 'proposed' && Date.parse(g.expiresAt) > now.getTime())
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
  const active = goals
    .filter((g) => g.state === 'active')
    .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
  if (pending.length === 0 && active.length === 0) return ''

  const isOverdue = (g: GoalDigest) => g.dueAt !== null && Date.parse(g.dueAt) < now.getTime()
  const overdue = active.filter(isOverdue).length
  const lines = [
    ...pending.map((g) => `Awaiting your Approve / Veto in the inbox: ${safeLine(g.title, GOAL_BLOCK_TITLE_CHARS)} — expires ${londonDayMonth(g.expiresAt)}.`),
    ...active.map((g) => {
      const title = safeLine(g.title, GOAL_BLOCK_TITLE_CHARS)
      if (!g.dueAt) return `Active: ${title}.`
      if (!isOverdue(g)) return `Active: ${title} — due ${londonDayMonth(g.dueAt)}.`
      const late = calendarDays(londonDate(new Date(g.dueAt)), today)
      return `Active: ${title} — ${late > 0 ? `${plural(late, 'day')} overdue` : 'overdue'} (due ${londonDayMonth(g.dueAt)}).`
    }),
  ].slice(0, MAX_GOAL_BLOCK_LINES)
  return [`Goals (${active.length} active${overdue > 0 ? ` · ${overdue} overdue` : ''}):`, ...lines].join('\n')
}

// ── Promise line (deterministic, appended after the questions) ───────────

export const PROMISE_LINE_MAX_CHARS = 300

function calendarDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / DAY_MS)
}

function dayMonthIn(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  const iso = d.toISOString()
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

// One line, only when something needs the operator: an open promise that is
// late or due today, or one kept / lapsed since the last message. '' otherwise.
// e.g. "Promises (7 open): P3 · 3 days late · <outcome> · P5 due today · ✓ P2 kept.
// Reply 'P3 kept', 'drop P3' or 'P3 by 20/10'."
export function buildPromiseLine(promises: PromisesDigest | null | undefined, now: Date): string {
  if (!promises) return ''
  const today = londonDate(now)
  const due = promises.open
    .map((p) => ({ p, late: calendarDays(p.dueDate, today) }))
    .filter((x) => x.late >= 0)
    .sort((a, b) => b.late - a.late || a.p.seq - b.p.seq)
  const closed = promises.closedSince.filter((p) => p.status === 'kept' || p.status === 'lapsed')
  if (due.length === 0 && closed.length === 0) return ''

  const head = `Promises (${promises.open.length} open): `
  const hintSeq = due[0]?.p.seq
  const hint = hintSeq === undefined ? '' : ` Reply 'P${hintSeq} kept', 'drop P${hintSeq}' or 'P${hintSeq} by ${dayMonthIn(today, 7)}'.`
  const render = (outcomeChars: number, keep: number, withHint: boolean): string => {
    const items = [
      ...due.map(({ p, late }) => {
        const when = late === 0 ? 'due today' : `${plural(late, 'day')} late`
        return outcomeChars > 0 ? `P${p.seq} · ${when} · ${safeLine(p.outcome, outcomeChars)}` : `P${p.seq} ${when}`
      }),
      ...closed.map((p) => (p.status === 'kept' ? `✓ P${p.seq} kept` : `✗ P${p.seq} lapsed`)),
    ].slice(0, keep)
    return `${head}${items.join(' · ')}.${withHint ? hint : ''}`
  }
  const total = due.length + closed.length
  for (const withHint of [true, false]) {
    for (let keep = total; keep >= 1; keep--) {
      for (const chars of [80, 50, 30, 0]) {
        const line = render(chars, keep, withHint)
        if (line.length <= PROMISE_LINE_MAX_CHARS) return line
      }
    }
  }
  return render(0, 1, false).slice(0, PROMISE_LINE_MAX_CHARS)
}
