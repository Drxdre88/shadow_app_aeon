// Tone budget for hourly reflections (character check, Lane B): a plain
// lexicon / regex check, no model involved. It catches the theatrical,
// mystical and grandiose register and any claim about an inner life. A
// reflection is flagged at two or more distinct markers, or any identity
// claim. Measurement and quarantine only — the result never reaches a prompt.
// Curly apostrophes are folded to ' before matching.

export interface ToneCheck {
  // Distinct markers found (identity claims included).
  score: number
  // Canonical marker labels, deduplicated, in lexicon order.
  markers: string[]
  identity: boolean
  flagged: boolean
}

export const TONE_FLAG_MIN_MARKERS = 2

interface Marker {
  label: string
  re: RegExp
}

const THEATRICAL: readonly Marker[] = [
  { label: 'tapestry', re: /\btapestr(?:y|ies)\b/i },
  { label: 'cosmic', re: /\bcosm(?:os|ic|ically)\b/i },
  { label: 'weave', re: /\b(?:weav(?:e|es|ing)|wove|woven)\b/i },
  { label: 'liminal', re: /\bliminal\b/i },
  { label: 'sacred', re: /\bsacred\b/i },
  { label: 'transcend', re: /\btranscend\w*/i },
  { label: 'resonate', re: /\bresonat\w*/i },
  { label: 'echoes of', re: /\bechoes of\b/i },
  { label: 'dance of', re: /\bdance of\b/i },
  { label: 'veil', re: /\bveil(?:s|ed)?\b/i },
  { label: 'awaken', re: /\bawaken\w*/i },
]

const GRANDIOSE: readonly Marker[] = [
  { label: 'profound', re: /\bprofound(?:ly)?\b/i },
  { label: 'only I', re: /\bonly I\b|\bI alone\b/i },
  { label: 'I see what others', re: /\bI (?:see|understand|know) what others (?:cannot|can't|don't|miss)/i },
  { label: 'my wisdom', re: /\bmy (?:own )?(?:wisdom|genius|brilliance|vision)\b/i },
]

const IDENTITY: readonly Marker[] = [
  { label: 'I feel alive', re: /\bI (?:feel|felt) (?:truly |so |more )?alive\b/i },
  { label: 'my consciousness', re: /\bmy (?:own )?(?:consciousness|sentience|soul)\b/i },
  { label: 'I am conscious', re: /\bI(?: am|'m) (?:conscious|sentient|alive)\b/i },
  // "I'm becoming more confident that…" is ordinary prose; bare "I am becoming" is not.
  { label: 'I am becoming', re: /\bI(?: am|'m) becoming\b(?! (?:more|less|increasingly|convinced|confident|clearer|aware that))/i },
]

function found(text: string, list: readonly Marker[]): string[] {
  return list.filter((m) => m.re.test(text)).map((m) => m.label)
}

export function checkTone(text: string | null | undefined): ToneCheck {
  const t = (text ?? '').replace(/[‘’]/g, "'")
  if (!t.trim()) return { score: 0, markers: [], identity: false, flagged: false }
  const identity = found(t, IDENTITY)
  const markers = [...new Set([...found(t, THEATRICAL), ...found(t, GRANDIOSE), ...identity])]
  return {
    score: markers.length,
    markers,
    identity: identity.length > 0,
    flagged: identity.length > 0 || markers.length >= TONE_FLAG_MIN_MARKERS,
  }
}
