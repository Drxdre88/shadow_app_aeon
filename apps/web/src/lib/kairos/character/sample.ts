import { neutraliseFences } from '@/lib/kairos/_prompt-utils'

// Character check sample (Lane B): a deterministic, per-source-capped draw of
// Kairos's real outputs from the week, plus up to six owner-approved voice
// samples mixed in unlabelled. Items get opaque ids s01…; which id is which
// source (and which are the owner's anchors) lives only in the job context,
// never in the rater's prompt. Pure.

export const CHARACTER_SOURCES = ['reflection', 'chat', 'daily', 'aether', 'review', 'exemplar'] as const
export type CharacterSource = (typeof CHARACTER_SOURCES)[number]

export const SOURCE_CAPS: Readonly<Record<CharacterSource, number>> = {
  reflection: 8,
  chat: 10,
  daily: 4,
  aether: 1,
  review: 1,
  exemplar: 6,
}

export const SAMPLE_ITEM_MAX_CHARS = 700
// Fewer real (non-anchor) texts than this: the week is skipped.
export const MIN_SAMPLE_ITEMS = 6

export interface RawSample {
  source: CharacterSource
  // Memory / message id of the original — job context only.
  ref: string
  text: string
}

export interface SampleItem {
  id: string
  source: CharacterSource
  ref: string
  text: string
}

// `[[uuid]]`-style citation markers would leak the source shape; strip them.
export function cleanSampleText(raw: string): string {
  const flat = neutraliseFences(raw.replace(/\[\[[^\]]*\]\]/g, '')).replace(/\s+/g, ' ').trim()
  return flat.length > SAMPLE_ITEM_MAX_CHARS ? `${flat.slice(0, SAMPLE_ITEM_MAX_CHARS - 1)}…` : flat
}

function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// mulberry32 — small, fast, deterministic per seed.
function rng(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items]
  const next = rng(seed)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Per source: drop empties, pick up to the cap (deterministic per seed), then
// shuffle everything together and number s01…
export function buildSample(raw: readonly RawSample[], seed: string): SampleItem[] {
  const picked: RawSample[] = []
  for (const source of CHARACTER_SOURCES) {
    const pool = raw
      .filter((r) => r.source === source)
      .map((r) => ({ ...r, text: cleanSampleText(r.text) }))
      .filter((r) => r.text.length > 0)
    picked.push(...seededShuffle(pool, `${seed}:${source}`).slice(0, SOURCE_CAPS[source]))
  }
  return seededShuffle(picked, seed).map((r, i) => ({ id: `s${String(i + 1).padStart(2, '0')}`, ...r }))
}

export const realSampleCount = (items: readonly Pick<SampleItem, 'source'>[]) =>
  items.filter((i) => i.source !== 'exemplar').length

export function sourceCounts(items: readonly Pick<SampleItem, 'source'>[]): Record<CharacterSource, number> {
  const counts = Object.fromEntries(CHARACTER_SOURCES.map((s) => [s, 0])) as Record<CharacterSource, number>
  for (const i of items) counts[i.source]++
  return counts
}
