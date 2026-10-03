import type { KairosAgendaItem } from '@/lib/data/validators/kairos-agenda'
import type { KairosPrediction } from '@/lib/data/validators/kairos-predictions'
import { formatAgendaWhen } from './agenda/rules'
import type { AgendaDigest, VerdictDigest } from './daily-message-today'
import { daysPastDue, isVerdictExpired } from './predictions/rules'

// ─────────────────────────────────────────────────────────────────────────
// Daily message tail (spec_one_mind) — two code-built lines appended after
// the promise line, never shown to the model: predictions awaiting the
// owner's verdict (R-numbers, only with KAIROS_PREDICTIONS on) and the next
// Horae items (A-numbers, only with the agenda flag on). Pure: no DB.
// ─────────────────────────────────────────────────────────────────────────

export const TAIL_LINE_MAX_CHARS = 300
export const MAX_HORAE_ITEMS = 3

function plain(text: string, max: number): string {
  const flat = text.replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

// Open predictions the owner must judge: flagged needs_verdict, or an
// owner-verdict claim whose due date has passed — while the 7-day verdict
// window is still open. Oldest due first.
export function pickVerdicts(open: readonly KairosPrediction[], now: Date): VerdictDigest[] {
  return open
    .filter((p) => !isVerdictExpired(p, now))
    .filter((p) => p.status === 'needs_verdict' || (p.check.kind === 'owner_verdict' && daysPastDue(p, now) > 0))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq)
    .map((p) => ({ seq: p.seq, claim: p.claim }))
}

// The next open Horae items, soonest first.
export function pickAgenda(open: readonly KairosAgendaItem[], max: number = MAX_HORAE_ITEMS): AgendaDigest[] {
  return open
    .filter((i) => i.status === 'open')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.seq - b.seq)
    .slice(0, max)
    .map((i) => ({ seq: i.seq, dueAt: i.dueAt, what: i.what }))
}

function fitLine(render: (chars: number, keep: number) => string, total: number): string {
  for (let keep = total; keep >= 1; keep--) {
    for (const chars of [90, 60, 40, 0]) {
      const line = render(chars, keep)
      if (line.length <= TAIL_LINE_MAX_CHARS) return line
    }
  }
  return render(0, 1).slice(0, TAIL_LINE_MAX_CHARS)
}

// e.g. "Needs your verdict: R3 · <claim> · R5 · <claim> — reply 'R3 right' or 'R3 wrong'."
export function buildVerdictLine(verdicts: readonly VerdictDigest[] | null | undefined): string {
  if (!verdicts || verdicts.length === 0) return ''
  const first = verdicts[0]!.seq
  const hint = ` — reply 'R${first} right' or 'R${first} wrong'.`
  return fitLine((chars, keep) => {
    const items = verdicts.slice(0, keep).map((v) => (chars > 0 ? `R${v.seq} · ${plain(v.claim, chars)}` : `R${v.seq}`))
    const more = verdicts.length > keep ? ` (+${verdicts.length - keep} more)` : ''
    return `Needs your verdict: ${items.join(' · ')}${more}${hint}`
  }, verdicts.length)
}

// e.g. "Horae: A2 Thu 08/10 — <what>; A3 Fri 09/10 — <what>; reply 'cancel A2'."
export function buildHoraeLine(agenda: readonly AgendaDigest[] | null | undefined): string {
  if (!agenda || agenda.length === 0) return ''
  const shown = agenda.slice(0, MAX_HORAE_ITEMS)
  const hint = `; reply 'cancel A${shown[0]!.seq}'.`
  return fitLine((chars, keep) => {
    const items = shown.slice(0, keep).map((a) => {
      const head = `A${a.seq} ${formatAgendaWhen(a.dueAt)}`
      return chars > 0 ? `${head} — ${plain(a.what, chars)}` : head
    })
    return `Horae: ${items.join('; ')}${hint}`
  }, shown.length)
}
