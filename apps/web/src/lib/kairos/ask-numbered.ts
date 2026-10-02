// ─────────────────────────────────────────────────────────────────────────
// Numbered answers to Kairos's open questions (pure — no DB, no network).
//
// The 06:00 message lists every open question as "Q<seq>". The operator
// answers by number, from any surface that routes text here (Telegram):
//   "Q12: yes, ship it"   "Q12 - …"   "Q12) …"   several blocks in one message
//   "skip Q12" / "drop Q12, Q14" — dismiss without answering.
// The Q prefix is required: bare "1. …" lines belong to the finished-cards
// (card_notes) answer format. A label only counts when its number is an
// open question; anything else is left to chat untouched.
// ─────────────────────────────────────────────────────────────────────────

export interface NumberedAnswer { seq: number; text: string }

export interface NumberedAnswerParse {
  answers: NumberedAnswer[]
  skips: number[]
}

// A label starts a line (or the message) or follows sentence punctuation, so
// "revenue in Q3 - Q4" mid-sentence is never read as a label.
const LABEL_RE = /(?<=^|[.;!?,])[ \t]*\bQ(\d{1,5})[ \t]*[:)\-–—]/gim
const SKIP_RE = /(?<=^|[.;!?,])[ \t]*\b(?:skip|drop)[ \t]+(Q\d{1,5}(?:(?:[ \t]*,[ \t]*|[ \t]+and[ \t]+|[ \t]*&[ \t]*|[ \t]+)Q\d{1,5})*)\b/gim
const SEQ_RE = /Q(\d{1,5})/gi

/** Cheap pre-check (no DB): does the message START with a Q label or a skip command? */
export function mightContainNumberedAnswers(body: string): boolean {
  return /^\s*(?:Q\d{1,5}[ \t]*[:)\-–—]|(?:skip|drop)[ \t]+Q\d{1,5}\b)/i.test(body)
}

// "Q12: what do you mean?" is a question back to Kairos, not an answer.
function isClarifyingQuestion(text: string): boolean {
  return text.length < 200 && text.trimEnd().endsWith('?')
}

interface Marker { start: number; end: number; kind: 'answer' | 'skip'; seqs: number[] }

export function parseNumberedAnswers(body: string, openSeqs: Iterable<number>): NumberedAnswerParse {
  const open = new Set(openSeqs)
  if (open.size === 0 || !mightContainNumberedAnswers(body)) return { answers: [], skips: [] }

  const markers: Marker[] = []
  for (const m of body.matchAll(SKIP_RE)) {
    const seqs = [...m[1]!.matchAll(SEQ_RE)].map((s) => Number(s[1])).filter((seq) => open.has(seq))
    if (seqs.length > 0) markers.push({ start: m.index!, end: m.index! + m[0].length, kind: 'skip', seqs })
  }
  for (const m of body.matchAll(LABEL_RE)) {
    const seq = Number(m[1])
    if (!open.has(seq)) continue
    const start = m.index!
    const end = start + m[0].length
    // "skip Q12, Q14: …" — the skip command owns that span.
    if (markers.some((k) => k.kind === 'skip' && start < k.end && end > k.start)) continue
    markers.push({ start, end, kind: 'answer', seqs: [seq] })
  }
  markers.sort((a, b) => a.start - b.start)

  const texts = new Map<number, string[]>()
  const skips = new Set<number>()
  markers.forEach((marker, i) => {
    if (marker.kind === 'skip') {
      marker.seqs.forEach((seq) => skips.add(seq))
      return
    }
    const next = markers[i + 1]?.start ?? body.length
    const text = body.slice(marker.end, next).trim()
    if (!text || isClarifyingQuestion(text)) return
    const seq = marker.seqs[0]!
    texts.set(seq, [...(texts.get(seq) ?? []), text])
  })

  const answers = [...texts.entries()].map(([seq, parts]) => ({ seq, text: parts.join('\n') }))
  // Answering wins over skipping the same question in one message.
  for (const { seq } of answers) skips.delete(seq)
  return { answers, skips: [...skips] }
}

export function hasNumberedMatches(parse: NumberedAnswerParse): boolean {
  return parse.answers.length > 0 || parse.skips.length > 0
}

const qList = (seqs: number[]) => [...seqs].sort((a, b) => a - b).map((s) => `Q${s}`).join(', ')

/** One-line Telegram ack: "✓ Q12, Q14 · skipped Q13 · still open: Q15, Q16". */
export function formatNumberedAck(outcome: { answered: number[]; skipped: number[]; failed: number[]; stillOpen: number[] }): string {
  const parts: string[] = []
  if (outcome.answered.length > 0) parts.push(`✓ ${qList(outcome.answered)}`)
  if (outcome.skipped.length > 0) parts.push(`skipped ${qList(outcome.skipped)}`)
  if (outcome.failed.length > 0) parts.push(`couldn't record ${qList(outcome.failed)}`)
  parts.push(outcome.stillOpen.length > 0 ? `still open: ${qList(outcome.stillOpen)}` : 'nothing else open')
  return parts.join(' · ')
}
