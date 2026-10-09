import { formatAgendaWhen } from './agenda/rules'
import type { DailyMessageInputs, OpenAskDigest } from './daily-message-prompt'
import { londonDate } from './daily-message-time'

// ─────────────────────────────────────────────────────────────────────────
// The 06:00 short brief (Wave 2 one-tap loop) — what Telegram shows. Pure.
// A bold headline, then at most 3 items that need the owner's verdict (an idea
// with Keep / Drop buttons, open questions by Q number, predictions due by R
// number, goal proposals, promises due by P number), one look-ahead line and a
// pointer to the inbox. The full message (narrative + every block) is what
// the inbox stores, so nothing cut here is lost. A quiet day is one line.
// ─────────────────────────────────────────────────────────────────────────

export const DAILY_BRIEF_MAX_CHARS = 800
export const DAILY_BRIEF_MAX_ITEMS = 3
export const QUIET_DAY_LINE = '**Quiet night — nothing needs your verdict today.**'
export const FULL_BRIEF_POINTER = 'The full brief is in your inbox.'
const HEADLINE_CHARS = 100
const LOOK_AHEAD_CHARS = 140
const OPENING_CHARS = 160
const ITEM_CHARS = [140, 100, 70, 40] as const
const DAY_MS = 86_400_000

export const overflowPointer = (n: number) => `+${n} more in your inbox.`

interface BriefItem {
  render: (chars: number) => string
  idea?: { id: string; title: string }
}

export interface DailyBrief {
  text: string
  // Ideas shown in the brief that carry Keep / Drop buttons.
  ideas: Array<{ id: string; title: string }>
  overflow: number
  quiet: boolean
}

function clip(text: string, max: number): string {
  const flat = text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const unmark = (line: string) => line.replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s*/, '').replace(/^[-•*]\s+/, '').trim()
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const NEXT_RE = /^\**\s*next\s*(?::\s*\**|\**\s*:)\s*/i
// A bold section label ("**Today**", "**Yesterday**:") is not a headline; a bold sentence is.
const isLabel = (line: string) => /^\*\*[^*]+\*\*:?$/.test(line) && unmark(line).split(/\s+/).length <= 3 && !/[.!?…]$/.test(unmark(line))

// The narrative's first real line (the model is asked to make it the headline).
export function briefHeadline(narrative: string): string | null {
  for (const raw of narrative.split('\n')) {
    const line = raw.trim()
    if (!line || isLabel(line) || NEXT_RE.test(line)) continue
    const text = clip(unmark(line), HEADLINE_CHARS)
    if (text) return text
  }
  return null
}

function oldestFirst(asks: ReadonlyArray<OpenAskDigest>): OpenAskDigest[] {
  return [...asks].sort((a, b) => a.askedAt.localeCompare(b.askedAt) || a.seq - b.seq)
}

// The one look-ahead line: the model's own "Next:" line, else the next Horae
// item, the soonest active goal or the soonest promise not yet due.
export function briefLookAhead(narrative: string, inputs: DailyMessageInputs, now: Date): string | null {
  const own = narrative.split('\n').map((l) => l.trim()).filter((l) => NEXT_RE.test(l)).at(-1)
  const ownText = own ? clip(unmark(own.replace(NEXT_RE, '')), LOOK_AHEAD_CHARS) : ''
  if (ownText) return `Next: ${ownText}`
  const agenda = inputs.agenda?.[0]
  if (agenda) return `Next: A${agenda.seq} ${formatAgendaWhen(agenda.dueAt)} — ${clip(agenda.what, 90)}`
  const goal = (inputs.goals ?? [])
    .filter((g) => g.state === 'active' && g.dueAt && Date.parse(g.dueAt) >= now.getTime())
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))[0]
  if (goal) return `Next: ${clip(goal.title, 90)} — due ${dayMonth(londonDate(new Date(goal.dueAt!)))}.`
  const today = londonDate(now)
  const promise = (inputs.promises?.open ?? []).filter((p) => p.dueDate > today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  if (promise) return `Next: P${promise.seq} due ${dayMonth(promise.dueDate)} · ${clip(promise.outcome, 90)}`
  return null
}

function lateDays(dueDate: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00.000Z`) - Date.parse(`${dueDate}T12:00:00.000Z`)) / DAY_MS)
}

// Every item awaiting a verdict, most useful first: the idea, the oldest
// question, the first prediction, goal proposal and promise due; then the rest.
export function briefVerdictItems(inputs: DailyMessageInputs, now: Date): BriefItem[] {
  const lead: BriefItem[] = []
  const rest: BriefItem[] = []
  const add = (items: BriefItem[]) => {
    if (items[0]) lead.push(items[0])
    rest.push(...items.slice(1))
  }
  const idea = inputs.idea
  if (idea) {
    const title = idea.title || idea.claim
    const where = idea.id ? 'Keep or Drop below' : 'in your inbox'
    lead.push({ render: (c) => `💡 Idea: ${clip(title, c)} — ${where}.`, ...(idea.id ? { idea: { id: idea.id, title } } : {}) })
  }
  add(oldestFirst(inputs.openAsks ?? []).map((a) => ({ render: (c) => `Q${a.seq} · ${clip(a.question, c)}` })))
  add((inputs.verdicts ?? []).map((v) => ({ render: (c) => `R${v.seq} · ${clip(v.claim, c)} — right or wrong?` })))
  add((inputs.goals ?? [])
    .filter((g) => g.state === 'proposed' && Date.parse(g.expiresAt) > now.getTime())
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
    .map((g) => ({ render: (c) => `Goal to approve or veto: ${clip(g.title, c)}` })))
  const today = londonDate(now)
  add((inputs.promises?.open ?? [])
    .map((p) => ({ p, late: lateDays(p.dueDate, today) }))
    .filter((x) => x.late >= 0)
    .sort((a, b) => b.late - a.late || a.p.seq - b.p.seq)
    .map(({ p, late }) => ({ render: (c) => `P${p.seq} · ${late === 0 ? 'due today' : `${plural(late, 'day')} late`} · ${clip(p.outcome, c)}` })))
  return [...lead, ...rest]
}

// Something worth a few lines even with no verdict pending.
function notable(inputs: DailyMessageInputs, now: Date): boolean {
  const overdueGoal = (inputs.goals ?? []).some((g) => g.state === 'active' && g.dueAt && Date.parse(g.dueAt) < now.getTime())
  const closedPromise = (inputs.promises?.closedSince ?? []).some((p) => p.status === 'kept' || p.status === 'lapsed')
  return Boolean(
    inputs.drift?.alert || inputs.drift?.conscience || (inputs.synthesis?.failed ?? 0) > 0 ||
    inputs.promotions?.length || inputs.newBeliefs?.length || (inputs.boardDay?.finished ?? 0) > 0 ||
    inputs.moment?.openings?.length || inputs.ideaDiversityAlarm || overdueGoal || closedPromise,
  )
}

export function buildDailyBrief(narrative: string, inputs: DailyMessageInputs, now: Date): DailyBrief {
  const items = briefVerdictItems(inputs, now)
  const othersWaiting = inputs.idea?.othersWaiting ?? 0
  const look = briefLookAhead(narrative, inputs, now)
  if (items.length === 0 && othersWaiting === 0 && !notable(inputs, now)) {
    const line = look ? `${QUIET_DAY_LINE} ${look}` : QUIET_DAY_LINE
    return { text: line.length <= DAILY_BRIEF_MAX_CHARS ? line : QUIET_DAY_LINE, ideas: [], overflow: 0, quiet: true }
  }

  const headline = `**${briefHeadline(narrative) ?? 'Morning.'}**`
  const opening = inputs.moment?.openings?.[0]?.trim()
  const render = (keep: number, chars: number, withOpening: boolean, withLook: boolean): DailyBrief => {
    const shown = items.slice(0, keep)
    const overflow = items.length - shown.length + othersWaiting
    const head = [...(withOpening && opening ? [clip(opening, OPENING_CHARS)] : []), headline].join('\n')
    const foot = [...(withLook && look ? [look] : []), overflow > 0 ? overflowPointer(overflow) : FULL_BRIEF_POINTER].join('\n')
    const text = [head, shown.map((i) => i.render(chars)).join('\n'), foot].filter(Boolean).join('\n\n')
    const ideas = shown.flatMap((i) => (i.idea ? [i.idea] : []))
    return { text, ideas, overflow, quiet: false }
  }
  for (let keep = Math.min(items.length, DAILY_BRIEF_MAX_ITEMS); keep >= 0; keep--) {
    for (const [withOpening, withLook] of [[true, true], [false, true], [false, false]] as const) {
      for (const chars of ITEM_CHARS) {
        const brief = render(keep, chars, withOpening, withLook)
        if (brief.text.length <= DAILY_BRIEF_MAX_CHARS) return brief
      }
    }
  }
  const last = render(0, 40, false, false)
  return { ...last, text: last.text.slice(0, DAILY_BRIEF_MAX_CHARS) }
}
