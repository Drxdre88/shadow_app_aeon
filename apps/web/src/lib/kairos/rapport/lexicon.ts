import type { BidKind } from '@/lib/data/validators/kairos-rapport'

// Deterministic owner-text lexicon (no model call). Change talk follows the
// MI families: commitment / activation / taking steps vs preparatory DARN vs
// sustain talk; a negated commitment counts as sustain.

export interface ChangeTalk {
  commit: number
  prep: number
  sustain: number
  markers: string[]
}

const normalise = (text: string): string => text.replace(/[\u2018\u2019\u02bc]/g, "'").toLowerCase()

const SUSTAIN = /\b(?:i can'?t|i cannot|i won'?t|i will not|i'?m not (?:going to|gonna)|i am not going to|not going to|not gonna|no time|too hard|what'?s the point|maybe later|i didn'?t|i haven'?t (?:started|done)|i don'?t (?:want to|think i can)|i give up|never mind)\b/g
const COMMIT = /\b(?:i will|i'll|i'?m going to|i am going to|i'?m gonna|gonna|i did|i'?ve (?:started|done|begun|booked|signed up)|i have (?:started|done|begun|booked|signed up)|i started|i booked|i signed up|booked|signed up|done|i'?m doing it|i committed)\b/g
const PREP = /\b(?:i want to|i want|i'?d like to|i would like to|i could|i might|i should|i need to|i wish|i hope to|i'?m thinking (?:of|about))\b/g
const NEGATION_BEFORE = /\b(?:not|never|no|don'?t|didn'?t|won'?t|can'?t|haven'?t)\s+(?:\w+\s+){0,2}$/
const NEGATION_AFTER = /^\s*(?:not|never)\b/

function clauses(text: string): string[] {
  return normalise(text).split(/[.!?;\n]+|,\s*but\b|\bbut\b/).map((c) => c.trim()).filter(Boolean)
}

function blank(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length)
}

function pushMarker(markers: string[], marker: string): void {
  const m = marker.trim().slice(0, 60)
  if (m && !markers.includes(m)) markers.push(m)
}

export function scoreChangeTalk(text: string): ChangeTalk {
  const out: ChangeTalk = { commit: 0, prep: 0, sustain: 0, markers: [] }
  for (const original of clauses(text)) {
    let clause = original
    for (const m of [...clause.matchAll(SUSTAIN)]) {
      out.sustain++
      pushMarker(out.markers, m[0])
      clause = blank(clause, m.index ?? 0, m[0].length)
    }
    for (const m of [...clause.matchAll(COMMIT)]) {
      const at = m.index ?? 0
      const negated = NEGATION_BEFORE.test(original.slice(0, at)) || NEGATION_AFTER.test(original.slice(at + m[0].length))
      if (negated) out.sustain++
      else out.commit++
      pushMarker(out.markers, m[0])
      clause = blank(clause, at, m[0].length)
    }
    for (const m of [...clause.matchAll(PREP)]) {
      const negated = NEGATION_BEFORE.test(original.slice(0, m.index ?? 0))
      if (negated) out.sustain++
      else out.prep++
      pushMarker(out.markers, m[0])
    }
  }
  return out
}

export const hasChangeTalk = (talk: ChangeTalk): boolean => talk.commit + talk.prep + talk.sustain > 0

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length

const COMMAND_START = /^(?:\/|(?:add|create|move|show|list|remind|tell|make|set|delete|remove|find|open|close|mark|schedule|plan|draft|write|summari[sz]e|explain|what|how|why|when|where|who|which|can you|could you|please)\b)/i
const URL_START = /^https?:\/\/\S+/i
const LAUGH = /\b(?:a?ha(?:ha)+|lol+|lmao|rofl|hehe+|haha)\b|😂|🤣|😆|😹/i
const SIGH = /\b(?:ugh+|sigh|meh|argh+|ffs|oof|bleh|blah)\b|🙄|😩|😮‍💨|😤|😫/i
const CHEER = /🎉|🥳|!!!|\b(?:yay+|woo+h?o*|yess+|nailed it|finally)\b/i

// A small bid for attention: a short, non-question, non-command message.
export function detectBid(text: string): BidKind | null {
  const t = text.trim()
  if (!t || t.includes('?') || wordCount(t) > 12) return null
  if (URL_START.test(t)) return 'link'
  if (COMMAND_START.test(t)) return null
  if (LAUGH.test(t)) return 'laugh'
  if (SIGH.test(t)) return 'sigh'
  if (CHEER.test(t)) return 'cheer'
  return null
}

const NOT_NOW_ANYWHERE = /\b(?:not now|not today|leave it|drop it|stop asking|can'?t talk|cannot talk|not right now|give me a break)\b/
const NOT_NOW_START = /^(?:later|stop|enough|busy|not now|not today|leave it|drop it|stop asking|can'?t talk)(?:\s*(?:pls|please|mate|man|thanks))?(?:\s*$|\s*[,.!—–-])/

// "Not now" is a strong rupture signal: an unambiguous phrase in a short
// message, or an ambiguous word (later / stop / enough / busy) leading it.
export function detectNotNow(text: string): boolean {
  const t = normalise(text).trim()
  if (!t) return false
  if (NOT_NOW_START.test(t)) return true
  return wordCount(t) <= 8 && NOT_NOW_ANYWHERE.test(t)
}

const TERSE_WORD = /^(?:ok|okay|k|kk|fine|sure|yep|yup|yes|no|nope|mhm|cool|right|alright|noted)[.!]*$/i

export function isTerse(text: string): boolean {
  const t = text.trim()
  return wordCount(t) <= 3 || TERSE_WORD.test(t)
}

const STOP = new Set([
  'about', 'after', 'again', 'also', 'because', 'been', 'before', 'being', 'could', 'does', 'doing', 'done', 'from',
  'gonna', 'going', 'have', 'into', 'just', 'like', 'more', 'much', 'only', 'other', 'really', 'should', 'some',
  'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'think', 'this', 'those', 'time',
  'very', 'want', 'were', 'what', 'when', 'where', 'which', 'while', 'will', 'with', 'would', 'your', 'today',
  'tomorrow', 'week', 'started', 'start', 'need', 'might', 'maybe', 'later', 'booked', 'signed',
])

function stem(word: string): string {
  for (const suffix of ['ings', 'ing', 'ers', 'ed', 'es', 's']) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) return word.slice(0, -suffix.length)
  }
  return word
}

// Content-word stems (≥4 letters, filler removed) for goal matching.
export function goalTerms(text: string): string[] {
  const out: string[] = []
  for (const w of normalise(text).replace(/'/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 4 || STOP.has(w)) continue
    const s = stem(w)
    if (!out.includes(s)) out.push(s)
  }
  return out
}
