import type { DeckToken, DeckVerdict } from './types'

// Owner replies to the Sunday verdict deck (pure). A deck reply is ONLY bare
// numbered verdicts: "1y 2n 3 skip", "4 yes, 5 no", "6 ✅ 7 ❌", "8: keep".
//   y / yes / ✅ / keep → yes     n / no / ❌ / drop → no     s / skip → skip
// Anything else in the message (a Q/R/D/P/A label, prose, a bare number with
// no verdict) means it is not a deck reply, so the other routers and chat
// keep it.

const TOKEN_RE = /^[\s,;·]*(\d{1,3})[ \t]*[.:)\-–—]?[ \t]*(yes|y|no|n|skip|s|keep|drop|✅|❌)(?!\p{L})/iu
const TRAILING_RE = /^[\s,;·.!]*$/u

const WORDS: Record<string, DeckVerdict> = {
  y: 'yes', yes: 'yes', keep: 'yes', '✅': 'yes',
  n: 'no', no: 'no', drop: 'no', '❌': 'no',
  s: 'skip', skip: 'skip',
}

export function parseDeckReply(body: string): DeckToken[] | null {
  let rest = body.trim()
  const out: DeckToken[] = []
  const seen = new Set<number>()
  while (rest && !TRAILING_RE.test(rest)) {
    const m = TOKEN_RE.exec(rest)
    if (!m) return null
    const n = Number(m[1])
    const verdict = WORDS[m[2]!.toLowerCase()]
    if (!verdict || n < 1) return null
    if (!seen.has(n)) {
      seen.add(n)
      out.push({ n, verdict })
    }
    rest = rest.slice(m[0].length)
  }
  return out.length > 0 ? out : null
}

export type DeckOutcome =
  | { n: number; status: 'done'; word: string }
  | { n: number; status: 'needs_text'; word: string }
  | { n: number; status: 'skipped' | 'unknown' | 'already_handled' | 'failed' | 'reply_needed' }

const STATUS_TEXT: Record<Exclude<DeckOutcome['status'], 'done' | 'needs_text'>, string> = {
  skipped: 'skipped',
  unknown: 'unknown',
  already_handled: 'already handled',
  failed: "couldn't record",
  reply_needed: 'not changed — reply to the deck to say no',
}

// One line: "✓ 1 kept · ✓ 2 dropped · 3 skipped · 4 unknown".
export function formatDeckAck(outcomes: ReadonlyArray<DeckOutcome>): string {
  return outcomes.map((o) => {
    if (o.status === 'done') return `✓ ${o.n} ${o.word}`
    if (o.status === 'needs_text') return `${o.n} reply "${o.word}" with your answer`
    return `${o.n} ${STATUS_TEXT[o.status]}`
  }).join(' · ')
}
