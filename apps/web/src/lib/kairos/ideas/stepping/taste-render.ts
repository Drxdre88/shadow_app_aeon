import type { SteppingMode } from './flag'
import { TASTE_DIMENSIONS, type IdeaTasteProfile, type TasteDimension } from './taste'

// The read view of get_kairos_idea_taste ≡ GET /api/v1/kairos/idea-taste, and its markdown.

export interface IdeaArchiveCounts {
  stones: number
  dismissed: number
  eliminated: number
  ignored: number
}

export interface IdeaTasteView {
  mode: { taste: SteppingMode; novelty: SteppingMode }
  noveltyEvery: number
  nextNoveltyNight: string | null
  profile: IdeaTasteProfile
  archive: IdeaArchiveCounts
}

const DIM_LABEL: Record<TasteDimension, string> = {
  area: 'Area',
  move: 'Move',
  kind: 'Kind',
  leap: 'Leap',
  length: 'Length',
}

export function renderIdeaTasteMarkdown(view: IdeaTasteView): string {
  const p = view.profile
  const t = p.totals
  const lines = [
    '# Kairos idea taste',
    `Taste: ${view.mode.taste} · novelty round: ${view.mode.novelty} (every ${view.noveltyEvery} nights${view.nextNoveltyNight ? `, next ${view.nextNoveltyNight}` : ''})`,
    `Last ${p.windowDays} days: ${t.accepted} accepted, ${t.dismissed} dismissed, ${t.ignored} ignored${p.active ? '' : ' (not active yet)'}.`,
    ...p.summary.map((s) => `- ${s}`),
  ]
  const leans = TASTE_DIMENSIONS.flatMap((d) => {
    const cells = p.features[d].filter((c) => c.confident).slice(0, 4)
    return cells.length ? [`${DIM_LABEL[d]}: ${cells.map((c) => `${c.label} ×${c.lift.toFixed(2)}`).join(', ')}`] : []
  })
  if (leans.length) lines.push('', ...leans)
  lines.push('', `Surprise slot: ${p.surprise.rule}`)
  const a = view.archive
  lines.push(`Stepping stones: ${a.stones} (${a.dismissed} dismissed, ${a.eliminated} eliminated, ${a.ignored} ignored).`)
  return lines.join('\n')
}
