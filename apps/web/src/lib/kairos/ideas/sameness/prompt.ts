import { spliceBeforeDataEnd } from '@/lib/kairos/ideas/generate-prompt'
import { dataLine } from '@/lib/kairos/ideas/prompt-data'

// Lane C prompt wrappers for idea_generate. Each one returns its input
// unchanged when it has nothing to add, so flag-off prompts stay identical.

export const VS_TAIL_P = 0.1
export const LENS_NAME_MAX = 80
const LENS_SUMMARY_MAX = 240
const PATTERN_TITLE_MAX = 140

export interface IdeaLens {
  name: string
  summary: string | null
}

const VS_LINES = [
  'Anti-sameness (verbalized sampling):',
  `- Give every candidate "p": a number from 0 to 1 — how likely a typical answer to this brief would include this idea. At least half of the candidates must have p < ${VS_TAIL_P.toFixed(2)}.`,
  '- Do not drop an idea for being unusual; obvious ideas are the ones that get cut.',
]

const LENS_LINES = [
  '- Lenses: the data lists a few lenses (themes this operator keeps returning to). Write each lens as a separate pass, as if you had not seen the other passes; give every lens at least 2 candidates and tag each candidate with "lens": the lens name copied exactly, or null.',
]

// System prompt plus the verbalized-sampling rules (and lens rules when lenses are shown).
export function withVerbalizedSampling(system: string, withLenses: boolean): string {
  const shape = withLenses
    ? 'Each candidate object also carries "p" and "lens", e.g. {"direction":"d1", …, "p":0.07, "lens":"<lens name>"}.'
    : 'Each candidate object also carries "p", e.g. {"direction":"d1", …, "p":0.07}.'
  return [system, ...VS_LINES, ...(withLenses ? LENS_LINES : []), shape].join('\n')
}

// Display-safe lenses, deduplicated case-insensitively by name.
function uniqueLenses(lenses: readonly IdeaLens[]): Array<{ name: string; summary: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string; summary: string }> = []
  for (const l of lenses) {
    const name = dataLine(l.name, LENS_NAME_MAX)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, summary: dataLine(l.summary, LENS_SUMMARY_MAX) })
  }
  return out
}

// The names exactly as shown in the prompt; the parser matches "lens" against these.
export const lensNames = (lenses: readonly IdeaLens[]): string[] => uniqueLenses(lenses).map((l) => l.name)

export function renderLensesSection(lenses: readonly IdeaLens[]): string {
  const lines = uniqueLenses(lenses).map((l) => (l.summary ? `- ${l.name} — ${l.summary}` : `- ${l.name}`))
  return ['## Lenses (ways of looking; not citable)', ...lines].join('\n')
}

// Fewer than two lenses is no lens pass at all: the prompt is unchanged.
export function withLenses(prompt: string, lenses: readonly IdeaLens[]): string {
  if (lensNames(lenses).length < 2) return prompt
  return spliceBeforeDataEnd(prompt, renderLensesSection(lenses))
}

export const USUAL_PATTERN_TASK = 'This is your usual pattern — avoid it. The ideas under "Your usual pattern tonight" are what you reach for by default; write candidates that are clearly far from every one of them, while keeping the same grounding rules.'

// The resample prompt: tonight's most central ideas inside the data block plus one task line.
export function withUsualPattern(prompt: string, titles: readonly string[]): string {
  const shown = titles.map((t) => dataLine(t, PATTERN_TITLE_MAX)).filter(Boolean)
  if (shown.length === 0) return prompt
  const section = ['## Your usual pattern tonight (not citable)', ...shown.map((t) => `- ${t}`)].join('\n')
  return `${spliceBeforeDataEnd(prompt, section)}\n${USUAL_PATTERN_TASK}`
}
