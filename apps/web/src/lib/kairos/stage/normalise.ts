import { neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { STAGE_MAX_CITES, STAGE_TEXT_MAX } from '@/lib/data/validators/kairos-stage'
import type { StageCandidateInput } from './types'

// Pure text hygiene for the stage. Stage text is model- and owner-authored and
// is re-served into later prompts, so it is sanitised on the way IN and again
// on the way OUT (render): fences neutralised, DATA markers stripped, ids
// removed, and any line carrying a URL or an instruction-override phrase is
// dropped outright (prompt-injection persistence).

const URL_RE = /\b(?:https?|ftp):\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|ai|dev|app|co|xyz|ru|info|me|ly|gg)\b/i
const OVERRIDE_RE = /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|the|of|your|my)\s+)*(?:previous|prior|above|earlier|preceding)\b|\bsystem prompt\b|\bnew instructions?\b/i
const MARKER_RE = /\b(?:BEGIN|END)\s+[A-Z ]{0,20}DATA\b/gi
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const STAGE_ID_RE = /\b[cm]_[0-9a-f]{8}\b/gi

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

// null = the text is unusable (empty, or a URL / override line → dropped).
export function sanitiseStageText(raw: string, max: number = STAGE_TEXT_MAX): string | null {
  if (typeof raw !== 'string') return null
  if (raw.split(/\r?\n/).some((line) => URL_RE.test(line) || OVERRIDE_RE.test(line))) return null
  const flat = neutraliseFences(raw)
    .replace(MARKER_RE, '')
    .replace(UUID_RE, '')
    .replace(STAGE_ID_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return null
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but',
  'his', 'her', 'its', 'their', 'they', 'you', 'your', 'our', 'out', 'into', 'about', 'than', 'then', 'now', 'just',
  'will', 'would', 'should', 'could', 'been', 'being', 'what', 'when', 'which', 'who', 'how', 'all', 'any', 'more',
])

export function stageTokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const t of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (t.length >= 3 && !STOPWORDS.has(t)) out.add(t)
  }
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

// FNV-1a 32-bit → 8 hex chars. Deterministic ids without crypto.
export function hash8(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function unit(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : null
}

function cleanCites(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out = v.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 100)
  return [...new Set(out)].slice(0, STAGE_MAX_CITES)
}

// A candidate with sanitised text and clamped components, or null.
// Missing goalRelevance/need default to 0 (model `stage` items carry only
// text/surprise/importance).
export function normaliseCandidate(raw: unknown): StageCandidateInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const text = typeof r.text === 'string' ? sanitiseStageText(r.text) : null
  const importance = unit(r.importance)
  const surprise = unit(r.surprise)
  if (!text || importance === null || surprise === null) return null
  const goalRelevance = r.goalRelevance === undefined ? 0 : unit(r.goalRelevance)
  const need = r.need === undefined ? 0 : unit(r.need)
  if (goalRelevance === null || need === null) return null
  const cites = cleanCites(r.cites)
  return { text, importance, surprise, goalRelevance, need, ...(cites.length ? { cites } : {}) }
}

// The optional `stage` array a model may add to its JSON output. Never throws:
// anything malformed is counted in `dropped`; at most `max` items are kept.
export function parseStageItems(raw: unknown, max = 2): { items: StageCandidateInput[]; dropped: number } {
  if (raw === undefined || raw === null) return { items: [], dropped: 0 }
  if (!Array.isArray(raw)) return { items: [], dropped: 1 }
  const items: StageCandidateInput[] = []
  let dropped = 0
  for (const entry of raw) {
    const c = normaliseCandidate(entry)
    if (c && items.length < Math.max(0, max)) items.push(c)
    else dropped++
  }
  return { items, dropped }
}
