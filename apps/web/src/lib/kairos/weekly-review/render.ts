import type { GroundedReviewAction, GroundedWeeklyReview } from './prompt'

// Plain renderers for the weekly review's three outputs: the stored
// observation, each review-action proposal, and the one spoken summary.

export function weeklyReviewTitle(isoWeek: string): string {
  return `Weekly review · ${isoWeek}`
}

function bullets(items: readonly string[]): string[] {
  return items.length ? items.map((s) => `- ${s}`) : ['- (none)']
}

export function renderWeeklyReviewMarkdown(review: GroundedWeeklyReview, isoWeek: string): string {
  const lines: string[] = [`**${weeklyReviewTitle(isoWeek)}**`, '', review.summary, '', '**Wins**', ...bullets(review.wins)]
  lines.push('', '**Drift (plan vs actual)**', ...bullets(review.drift))
  lines.push('', '**Proposed actions**')
  if (review.actions.length === 0) lines.push('- (none grounded)')
  review.actions.forEach((a, i) => {
    const dom = a.dominionName ? ` · ${a.dominionName}` : ''
    const idea = a.ideaQuality ? ' · idea quality' : ''
    lines.push(`${i + 1}. **${a.title}**${dom}${idea} — ${a.why} (evidence: ${a.evidenceIds.join(', ')})`)
  })
  return lines.join('\n')
}

export function renderReviewActionBody(action: GroundedReviewAction, isoWeek: string): string {
  return [
    action.why,
    '',
    `From the ${isoWeek} weekly review${action.dominionName ? ` · ${action.dominionName}` : ''}${action.ideaQuality ? ' · about idea quality (lessons from accepted vs dismissed ideas)' : ''}.`,
    `Evidence: ${action.evidenceIds.join(', ')}`,
  ].join('\n')
}

// The spoken summary: the model's prose (already guarded against headings and
// URLs) plus one deterministic pointer to the proposals.
export function renderWeeklyReviewMessage(review: GroundedWeeklyReview, proposalCount: number): string {
  if (proposalCount === 0) return review.summary
  const noun = proposalCount === 1 ? 'action' : 'actions'
  return `${review.summary}\n\nI've put ${proposalCount} proposed ${noun} for this week in your inbox.`
}
