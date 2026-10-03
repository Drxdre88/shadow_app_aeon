// The hidden stance tag on judgement turns (KAIROS_COLD_READ). The chat
// prompt asks for one final `<stance>value — gist</stance>` line; Aeon strips
// every tag before a reply is persisted or delivered and keeps the last valid
// one on the chat job's output for the cold read. Pure, no I/O.

export const STANCE_VALUES = ['endorse', 'lean_endorse', 'mixed', 'lean_against', 'against'] as const
export type StanceValue = (typeof STANCE_VALUES)[number]

export interface Stance {
  value: StanceValue
  gist: string
}

export const STANCE_GIST_MAX_CHARS = 160

export const COLD_READ_CHAT_LINES = [
  '- Before judging the operator\'s plan, decision or reasoning, ask what you\'d say if a stranger proposed it; if that differs, say both.',
  '- Only on such turns, end with one final line `<stance>endorse|lean_endorse|mixed|lean_against|against — ≤15-word gist</stance>`; Aeon removes it before the operator sees it.',
]

const CLOSED_TAG = /[ \t]*<\s*stance\s*>([\s\S]*?)<\s*\/\s*stance\s*>[ \t]*/gi
// An unclosed tag swallows everything to the end, across lines (a trailing
// newline or a gist on the next line must never leak the tag to the owner).
const DANGLING_OPEN = /[ \t]*<\s*stance\s*>([\s\S]*)$/i
const STRAY_CLOSE = /[ \t]*<\s*\/\s*stance\s*>[ \t]*/gi
const SEPARATORS = ['—', '–', ':', '|', ' - ']

export function isStanceValue(v: unknown): v is StanceValue {
  return typeof v === 'string' && (STANCE_VALUES as readonly string[]).includes(v)
}

export function parseStanceBody(body: string): Stance | null {
  const inner = body.trim()
  if (!inner) return null
  let cut = -1
  let sepLen = 0
  for (const sep of SEPARATORS) {
    const i = inner.indexOf(sep)
    if (i !== -1 && (cut === -1 || i < cut)) {
      cut = i
      sepLen = sep.length
    }
  }
  const rawValue = cut === -1 ? inner : inner.slice(0, cut)
  const value = rawValue.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (!isStanceValue(value)) return null
  const gist = cut === -1 ? '' : inner.slice(cut + sepLen).trim().replace(/\s+/g, ' ')
  return { value, gist: gist.slice(0, STANCE_GIST_MAX_CHARS) }
}

export function extractStance(text: string): { text: string; stance: Stance | null } {
  const bodies: string[] = []
  let out = text.replace(CLOSED_TAG, (_m, body: string) => {
    bodies.push(body)
    return ''
  })
  const dangling = out.match(DANGLING_OPEN)
  if (dangling) {
    bodies.push(dangling[1] ?? '')
    out = out.slice(0, dangling.index)
  }
  out = out.replace(STRAY_CLOSE, '')
  if (out === text) return { text, stance: null }

  let stance: Stance | null = null
  for (let i = bodies.length - 1; i >= 0 && !stance; i--) stance = parseStanceBody(bodies[i] ?? '')
  return { text: out.replace(/\n{3,}/g, '\n\n').trimEnd(), stance }
}
