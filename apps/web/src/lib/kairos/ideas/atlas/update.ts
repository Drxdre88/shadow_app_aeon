import { ELO_START } from '../types'
import { ATLAS_CLAIM_MAX, ATLAS_MAX_CELLS, ATLAS_MAX_HISTORY, ATLAS_TITLE_MAX, type AtlasCell, type KairosIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { allCells, parseCellKey } from './cells'
import type { IdeaAtlasMode } from './flag'

// Nightly atlas update (MAP-Elites, lane A). Pure: decideAtlasNight says who
// takes which cell; applyAtlasNight folds that into a new state. An empty
// cell goes to tonight's best viable candidate in it (by Elo, then wins, then
// key); an occupied cell changes hands only when its challenger beat the
// holder in both orders ('on' mode). A draw or loss is a defence. Observe
// mode only fills empty cells. A night already applied is a no-op.

export type AtlasTook = 'filled' | 'replaced'
export type ChallengeResult = 'win' | 'draw' | 'loss' | 'none'

export interface AtlasNightEntry {
  key: string
  cell: string
  // Not eliminated before ranking (ranked_out counts as viable).
  viable: boolean
  elo: number | null
  wins: number
}

export interface AtlasChallengeOutcome {
  cell: string
  key: string
  result: ChallengeResult
}

export interface AtlasNightDecision {
  noop: boolean
  took: Map<string, AtlasTook>
  defended: string[]
  challenged: string[]
  tries: Map<string, number>
}

const keyNum = (k: string) => Number(k.replace(/^\D+/, ''))

function better(a: AtlasNightEntry, b: AtlasNightEntry): number {
  const ea = a.elo ?? ELO_START
  const eb = b.elo ?? ELO_START
  if (ea !== eb) return eb - ea
  if (a.wins !== b.wins) return b.wins - a.wins
  const na = keyNum(a.key)
  const nb = keyNum(b.key)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export function decideAtlasNight(
  state: KairosIdeaAtlasState,
  date: string,
  entries: readonly AtlasNightEntry[],
  challenges: readonly AtlasChallengeOutcome[],
  mode: IdeaAtlasMode,
): AtlasNightDecision {
  const decision: AtlasNightDecision = { noop: false, took: new Map(), defended: [], challenged: [], tries: new Map() }
  if (mode === 'off' || state.lastNight === date) return { ...decision, noop: true }
  const byCell = new Map<string, AtlasNightEntry[]>()
  for (const e of entries) {
    if (!parseCellKey(e.cell)) continue
    decision.tries.set(e.cell, (decision.tries.get(e.cell) ?? 0) + 1)
    if (!e.viable) continue
    byCell.set(e.cell, [...(byCell.get(e.cell) ?? []), e])
  }
  for (const [cell, list] of byCell) {
    if (state.cells[cell]?.holder) continue
    const best = [...list].sort(better)[0]
    if (best) decision.took.set(best.key, 'filled')
  }
  if (mode !== 'on') return decision
  const viable = new Set(entries.filter((e) => e.viable).map((e) => e.key))
  for (const ch of challenges) {
    const holder = state.cells[ch.cell]?.holder
    if (!holder || decision.challenged.includes(ch.cell)) continue
    decision.challenged.push(ch.cell)
    if (ch.result === 'win' && viable.has(ch.key)) decision.took.set(ch.key, 'replaced')
    else if (ch.result === 'draw' || ch.result === 'loss') decision.defended.push(ch.cell)
  }
  return decision
}

export interface AtlasHolderSource {
  memoryId: string
  title: string
  claim: string
  elo: number | null
}

export interface AtlasNightApply {
  date: string
  entries: readonly AtlasNightEntry[]
  decision: AtlasNightDecision
  holders: ReadonlyMap<string, AtlasHolderSource>
  targets: readonly string[]
  areaIds: readonly string[]
}

const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

function blankCell(cell: string): AtlasCell | null {
  const ref = parseCellKey(cell)
  return ref ? { ...ref, holder: null, tries: 0, targetedOn: null, lastChallengeOn: null } : null
}

export function atlasCoverage(state: KairosIdeaAtlasState, areaIds: readonly string[]): number {
  const grid = allCells(areaIds)
  if (grid.length === 0) return 0
  const held = grid.filter((c) => state.cells[`${c.area}|${c.kind}|${c.leap}`]?.holder).length
  return Math.round((held / grid.length) * 1000) / 1000
}

export function applyAtlasNight(state: KairosIdeaAtlasState, input: AtlasNightApply): KairosIdeaAtlasState {
  const { date, decision } = input
  const cells: Record<string, AtlasCell> = {}
  for (const [k, c] of Object.entries(state.cells)) cells[k] = { ...c, holder: c.holder ? { ...c.holder } : null }
  const touch = (cell: string): AtlasCell | null => {
    if (cells[cell]) return cells[cell]
    if (Object.keys(cells).length >= ATLAS_MAX_CELLS) return null
    const blank = blankCell(cell)
    if (blank) cells[cell] = blank
    return blank
  }
  for (const [cell, n] of decision.tries) {
    const c = touch(cell)
    if (c) c.tries += n
  }
  const cellOf = new Map(input.entries.map((e) => [e.key, e.cell]))
  let filled = 0
  let replaced = 0
  for (const [key, took] of decision.took) {
    const src = input.holders.get(key)
    const cell = cellOf.get(key)
    const c = cell ? touch(cell) : null
    if (!src || !c) continue
    c.holder = { memoryId: src.memoryId, title: clip(src.title, ATLAS_TITLE_MAX), claim: clip(src.claim, ATLAS_CLAIM_MAX), since: date, elo: src.elo, defended: 0 }
    if (took === 'filled') filled++
    else replaced++
  }
  for (const cell of decision.challenged) {
    const c = cells[cell]
    if (c) c.lastChallengeOn = date
  }
  for (const cell of decision.defended) {
    const h = cells[cell]?.holder
    if (h) h.defended++
  }
  const targets = input.targets.filter((t) => parseCellKey(t)).slice(0, 16)
  for (const t of targets) {
    const c = touch(t)
    if (c) c.targetedOn = date
  }
  const next: KairosIdeaAtlasState = { v: 1, lastNight: date, cells, history: state.history }
  const entry = { date, filled, replaced, defended: decision.defended.length, targets, coverage: atlasCoverage(next, input.areaIds) }
  return { ...next, history: [...state.history, entry].slice(-ATLAS_MAX_HISTORY) }
}
