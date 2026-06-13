import type { AetherPayload } from './aether-types'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Asks — pure selection logic (NO DB imports).
//
// Aether produces candidate questions and tensions; this module selects the
// single one worth interrupting the operator with. Kept free of any database
// or runtime imports so it can be unit-tested in isolation. The DB-backed
// orchestrators live in ./ask.
// ─────────────────────────────────────────────────────────────────────────

export const DEFAULT_BAR = 0.78
export const DEFAULT_MIN_INTERVAL_HOURS = 20

export type SelectInput = {
  latest: AetherPayload
  priorThoughtSourceIds: string[][]
  addressedSourceIds: Set<string>
  lastAskedAt: Date | null
  now: Date
  opts?: { bar?: number; minIntervalHours?: number }
}

export type SelectResult = {
  question: string
  dominionId: string | null
  sourceThoughtId: string | null
  sourceMemoryIds: string[]
  score: number
}

type Candidate = SelectResult & { persisted: boolean }

function isInterrogative(text: string): boolean {
  const trimmed = text.trim()
  return (
    trimmed.endsWith('?') ||
    /^(what|why|how|when|where|who|should|could|would|is|are|do|does|did|will|can)\b/i.test(trimmed)
  )
}

function toQuestion(thought: { title: string; insight: string }): string {
  if (isInterrogative(thought.title)) return thought.title.trim()
  const firstSentence = thought.insight.split(/[.!?]/)[0]?.trim() ?? ''
  if (firstSentence && isInterrogative(firstSentence)) {
    return firstSentence.endsWith('?') ? firstSentence : firstSentence + '?'
  }
  const t = thought.title.trim()
  return t.endsWith('?') ? t : t + '?'
}

function allAddressed(ids: string[], set: Set<string>): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id))
}

function isPersisted(ids: string[], priorArrays: string[][]): boolean {
  return priorArrays.some((prior) => ids.some((id) => prior.includes(id)))
}

/** Pure selection function — no DB calls. Unit-testable in isolation. */
export function selectKairosQuestion(input: SelectInput): SelectResult | null {
  const {
    latest,
    priorThoughtSourceIds,
    addressedSourceIds,
    lastAskedAt,
    now,
    opts = {},
  } = input

  const bar = opts.bar ?? DEFAULT_BAR
  const minIntervalHours = opts.minIntervalHours ?? DEFAULT_MIN_INTERVAL_HOURS

  if (lastAskedAt !== null) {
    const elapsedMs = now.getTime() - lastAskedAt.getTime()
    if (elapsedMs < minIntervalHours * 60 * 60 * 1000) {
      return null
    }
  }

  const candidates: Candidate[] = []

  for (const thought of latest.thoughts) {
    if (thought.kind !== 'question' && thought.kind !== 'tension') continue

    const ids = thought.sourceMemoryIds
    if (allAddressed(ids, addressedSourceIds)) continue

    const base = thought.salience
    const persistenceBoost = isPersisted(ids, priorThoughtSourceIds) ? 0.15 : 0
    const score = base + persistenceBoost

    candidates.push({
      question: toQuestion(thought),
      dominionId: thought.dominionId,
      sourceThoughtId: thought.id,
      sourceMemoryIds: ids,
      score,
      persisted: persistenceBoost > 0,
    })
  }

  for (const tension of latest.tensions) {
    const thoughtA = latest.thoughts.find((t) => t.id === tension.aId)
    const thoughtB = latest.thoughts.find((t) => t.id === tension.bId)

    const merged = [
      ...(thoughtA?.sourceMemoryIds ?? []),
      ...(thoughtB?.sourceMemoryIds ?? []),
    ]
    const uniqueIds = [...new Set(merged)]

    if (allAddressed(uniqueIds, addressedSourceIds)) continue

    const base = 0.75
    const persistenceBoost = isPersisted(uniqueIds, priorThoughtSourceIds) ? 0.15 : 0
    const score = base + persistenceBoost

    const tensionNote = tension.note.trim()
    candidates.push({
      question: tensionNote.endsWith('?') ? tensionNote : tensionNote + '?',
      dominionId: null,
      sourceThoughtId: null,
      sourceMemoryIds: uniqueIds,
      score,
      persisted: persistenceBoost > 0,
    })
  }

  const eligible = candidates.filter((c) => c.score >= bar)
  if (eligible.length === 0) return null

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.persisted !== a.persisted) return b.persisted ? 1 : -1
    return 0
  })

  const winner = eligible[0]!
  return {
    question: winner.question,
    dominionId: winner.dominionId,
    sourceThoughtId: winner.sourceThoughtId,
    sourceMemoryIds: winner.sourceMemoryIds,
    score: winner.score,
  }
}
