import { OWNER_ITEM_TEXT_MAX } from '@/lib/data/validators/kairos-owner-model'

// Pure text helpers shared by extraction, rules and renderers (no I/O, no DB).

// Health / clinical labels are never recorded, even when he names them.
const HEALTH_RE = /\b(depress\w*|bipolar|adhd|ocd|ptsd|autis\w*|asperger\w*|insomnia\w*|diagnos\w*|disorder\w*|clinical\w*|psychiatr\w*|therap\w*|medicat\w*|illness\w*|burn-?out|manic|mania|schizo\w*|anorexi\w*|bulimi\w*|suicid\w*|self-harm\w*|trauma\w*|neurodiverg\w*|panic attack\w*)\b/i

export function mentionsHealth(text: string): boolean {
  return HEALTH_RE.test(text)
}

// One line, no fences or data markers, so it cannot break a prompt block.
export function neutralise(text: string): string {
  return text
    .replace(/```+/g, '')
    .replace(/<<<|>>>/g, '')
    .replace(/\b(END )?OWNER MODEL DATA\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function clipText(text: string, max: number = OWNER_ITEM_TEXT_MAX): string {
  const s = neutralise(text)
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

export function normaliseText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokens(text: string): Set<string> {
  return new Set(normaliseText(text).split(' ').filter((t) => t.length > 2))
}

// Overlap of the smaller token set (0–1); 0 when either side has no tokens.
export function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / Math.min(ta.size, tb.size)
}

// dd/mm (UTC day).
export function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '?'
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export const utcDayOf = (iso: string): string => new Date(iso).toISOString().slice(0, 10)
