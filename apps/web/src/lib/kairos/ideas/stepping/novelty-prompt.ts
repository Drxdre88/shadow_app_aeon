import { spliceBeforeDataEnd } from '@/lib/kairos/ideas/generate-prompt'
import { dataLine } from '@/lib/kairos/ideas/prompt-data'
import type { SteppingStone, SteppingStoneReason } from './stones'

// Pure-novelty round prompt text. Stones are text only: no ids, never in validMemoryIds, never citable.

export const STEPPING_STONES_MAX = 12
const STONE_MAX = 260

export const NOVELTY_ROUND_ADDENDUM = [
  'Tonight is a pure-novelty round. Past outcomes and the operator\'s usual taste are set aside on purpose.',
  '- Aim for ideas unlike anything proposed before: new angles, odd combinations, inversions, things nobody here has tried.',
  '- The stepping stones in the data are past ideas that were dismissed, lost or ignored. Use them only as raw material (mutate, invert, combine, take one detail further); never resubmit one as it was.',
  '- Stepping stones are not evidence and cannot be cited. Every candidate still cites at least one id from the [brackets].',
].join('\n')

const REASON_LABEL: Record<SteppingStoneReason, string> = {
  owner_dismissed: 'dismissed by the operator',
  ignored: 'left untouched',
  ungrounded: 'lost: thin evidence',
  contradicted: 'lost: evidence disagreed',
  already_known: 'lost: already known',
  not_different: 'lost: too close to an older idea',
  ranked_out: 'lost the head-to-heads',
}

export function renderStonesBlock(stones: readonly SteppingStone[]): string {
  const lines = ['## Stepping stones (past ideas as raw material; no ids, not citable)']
  for (const s of stones.slice(0, STEPPING_STONES_MAX)) {
    const text = s.title && s.claim ? `${s.title}: ${s.claim}` : s.title || s.claim
    lines.push(`- (${REASON_LABEL[s.reason]}) ${dataLine(text, STONE_MAX).replace(/\[/g, '(').replace(/\]/g, ')')}`)
  }
  return lines.join('\n')
}

export function applyNoveltyRound(
  plan: { system: string; prompt: string },
  stones: readonly SteppingStone[],
): { system: string; prompt: string } {
  const system = `${plan.system}\n${NOVELTY_ROUND_ADDENDUM}`
  const prompt = stones.length > 0 ? spliceBeforeDataEnd(plan.prompt, renderStonesBlock(stones)) : plan.prompt
  return { system, prompt }
}
