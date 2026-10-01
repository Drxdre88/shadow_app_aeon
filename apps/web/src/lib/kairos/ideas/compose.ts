import type { IdeaCritique } from './types'
import type { EloRecord } from './elo'

// Survivor rendering for the idea tournament (docs/kairos/35): the one-line
// "survived because", the inbox body, and the survivor's home Dominion.

export interface EvidenceRef {
  id: string
  title: string
  dominionId: string | null
}

const quote = (s: string) => `“${s.replace(/\s+/g, ' ').trim().slice(0, 80)}”`

export function survivedBecause(critique: IdeaCritique, record: EloRecord | null, evidence: ReadonlyMap<string, EvidenceRef>): string {
  const titles = critique.supports.map((id) => evidence.get(id)?.title).filter((t): t is string => Boolean(t?.trim()))
  const backed = titles.length === 0
    ? `Backed by ${critique.supports.length} piece${critique.supports.length === 1 ? '' : 's'} of evidence`
    : titles.length === 1
      ? `Backed by ${quote(titles[0])}`
      : `Backed by ${quote(titles[0])} and ${titles.length === 2 ? quote(titles[1]) : `${titles.length - 1} more`}`
  const played = record ? record.wins + record.losses + record.draws : 0
  const games = played === 0 ? 'unopposed tonight' : `won ${record?.wins ?? 0} of ${played} head-to-heads`
  return `${backed}; ${games}.`
}

// Plurality Dominion of the evidence; a tie or no Dominion at all → null.
export function majorityDominion(evidenceIds: readonly string[], evidence: ReadonlyMap<string, EvidenceRef>): string | null {
  const counts = new Map<string, number>()
  for (const id of new Set(evidenceIds)) {
    const d = evidence.get(id)?.dominionId
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1)
  }
  let best: string | null = null
  let bestN = 0
  let tie = false
  for (const [d, n] of counts) {
    if (n > bestN) {
      best = d
      bestN = n
      tie = false
    } else if (n === bestN) {
      tie = true
    }
  }
  return tie ? null : best
}

export interface IdeaBodyInput {
  direction: string
  claim: string
  why: string
  nextStep: string
  evidenceIds: string[]
  survivedBecause: string | null
}

export function renderIdeaBody(input: IdeaBodyInput, evidence: ReadonlyMap<string, EvidenceRef>): string {
  const lines = [
    `_Direction: ${input.direction}_`,
    '',
    `**Claim.** ${input.claim}`,
    '',
    `**Why it matters.** ${input.why}`,
    '',
    `**Next step.** ${input.nextStep}`,
    '',
    '**Evidence**',
    ...(input.evidenceIds.length
      ? input.evidenceIds.map((id) => `- ${evidence.get(id)?.title?.replace(/\s+/g, ' ').trim() || 'memory'} (${id})`)
      : ['- (none)']),
  ]
  if (input.survivedBecause) lines.push('', `**Survived because:** ${input.survivedBecause}`)
  return lines.join('\n')
}
