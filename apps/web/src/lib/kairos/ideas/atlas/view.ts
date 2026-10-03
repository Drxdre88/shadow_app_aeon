import type { AtlasHistoryEntry, KairosIdeaAtlasState } from '@/lib/data/validators/kairos-idea-atlas'
import { IDEA_KINDS, IDEA_LEAPS, type IdeaKind, type IdeaLeap } from '../types'
import { ATLAS_CROSS_AREA, allCells, cellKey, parseCellKey } from './cells'
import { atlasCoverage } from './update'

// Read view of the idea atlas (MCP get_kairos_idea_atlas ≡ GET
// /api/v1/kairos/idea-atlas). Areas are the active Dominions + cross-cutting;
// a retired Dominion's cells stay in state but are hidden here.

export interface IdeaAtlasCellView {
  kind: IdeaKind
  leap: IdeaLeap
  holder: { memoryId: string; title: string; since: string; elo: number | null; defended: number } | null
  tries: number
  targetedOn: string | null
}

export interface IdeaAtlasAreaView {
  id: string
  name: string
  held: number
  cells: IdeaAtlasCellView[]
}

export interface IdeaAtlasView {
  lastNight: string | null
  coverage: number
  cellsTotal: number
  cellsHeld: number
  areas: IdeaAtlasAreaView[]
  neverTried: string[]
  lastTargets: string[]
  history: AtlasHistoryEntry[]
}

const NEVER_TRIED_MAX = 20
const HISTORY_SHOWN = 7

function label(cell: string, names: ReadonlyMap<string, string>): string {
  const ref = parseCellKey(cell)
  if (!ref) return cell
  const area = ref.area === ATLAS_CROSS_AREA ? 'cross-cutting' : names.get(ref.area) ?? 'retired area'
  return `${area} · ${ref.kind} · ${ref.leap}`
}

export function toIdeaAtlasView(state: KairosIdeaAtlasState, dominions: ReadonlyArray<{ id: string; name: string }>): IdeaAtlasView {
  const names = new Map(dominions.map((d) => [d.id, d.name]))
  const areaIds = dominions.map((d) => d.id)
  const areas: IdeaAtlasAreaView[] = [...areaIds, ATLAS_CROSS_AREA].map((id) => {
    const cells: IdeaAtlasCellView[] = []
    for (const kind of IDEA_KINDS) {
      for (const leap of IDEA_LEAPS) {
        const c = state.cells[cellKey(id, kind, leap)]
        const h = c?.holder ?? null
        cells.push({
          kind,
          leap,
          holder: h ? { memoryId: h.memoryId, title: h.title, since: h.since, elo: h.elo, defended: h.defended } : null,
          tries: c?.tries ?? 0,
          targetedOn: c?.targetedOn ?? null,
        })
      }
    }
    return { id, name: id === ATLAS_CROSS_AREA ? 'cross-cutting' : names.get(id) ?? id, held: cells.filter((c) => c.holder).length, cells }
  })
  const grid = allCells(areaIds)
  const neverTried = grid
    .map((c) => cellKey(c.area, c.kind, c.leap))
    .filter((k) => !state.cells[k] || (state.cells[k].tries === 0 && !state.cells[k].holder))
    .slice(0, NEVER_TRIED_MAX)
    .map((k) => label(k, names))
  const last = state.history[state.history.length - 1]
  return {
    lastNight: state.lastNight,
    coverage: atlasCoverage(state, areaIds),
    cellsTotal: grid.length,
    cellsHeld: areas.reduce((n, a) => n + a.held, 0),
    areas,
    neverTried,
    lastTargets: (last?.targets ?? []).map((t) => label(t, names)),
    history: state.history.slice(-HISTORY_SHOWN),
  }
}

const cellText = (c: IdeaAtlasCellView | undefined) =>
  c?.holder ? c.holder.title.replace(/\|/g, '/').slice(0, 60) : c && c.tries > 0 ? `· (${c.tries} tried)` : '—'

export function renderIdeaAtlasMarkdown(view: IdeaAtlasView): string {
  const lines = [
    '# Idea atlas',
    '',
    `Coverage ${Math.round(view.coverage * 100)}% (${view.cellsHeld}/${view.cellsTotal} cells held)${view.lastNight ? ` · last night ${view.lastNight}` : ''}`,
  ]
  for (const area of view.areas) {
    lines.push('', `## ${area.name} (${area.held}/${area.cells.length})`, '', '| kind | near | far |', '|---|---|---|')
    for (const kind of IDEA_KINDS) {
      const near = area.cells.find((c) => c.kind === kind && c.leap === 'near')
      const far = area.cells.find((c) => c.kind === kind && c.leap === 'far')
      lines.push(`| ${kind} | ${cellText(near)} | ${cellText(far)} |`)
    }
  }
  if (view.neverTried.length) lines.push('', '## Never tried', ...view.neverTried.map((t) => `- ${t}`))
  if (view.lastTargets.length) lines.push('', '## Last targets', ...view.lastTargets.map((t) => `- ${t}`))
  return lines.join('\n')
}
