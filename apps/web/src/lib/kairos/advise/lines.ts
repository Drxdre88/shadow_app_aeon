import { OFFER_QUESTION, type AdviceMode } from './classify'

// Chat style lines per advice mode. Rendered after the cold-read lines, so
// "no <stance> line this turn" overrides the cold-read instruction.

export function adviceStyleLines(mode: AdviceMode, opts: { coldRead: boolean }): string[] {
  const noStance = opts.coldRead ? ['- No `<stance>` line on this turn.'] : []
  if (mode === 'offer') {
    return [
      `- The operator is sharing a plan or problem. Don't advise yet: reflect its core in one sentence, then ask exactly "${OFFER_QUESTION}" End there. For this turn skip the headline, blockquote and length rules.`,
      ...noStance,
    ]
  }
  if (mode === 'listen') {
    return [
      "- The operator wants to think out loud. Don't give your view. Ask one open question at a time, reflect back what they said and name tensions they stated. If they ask for your view, give it.",
      ...noStance,
    ]
  }
  if (mode === 'advise') {
    return [
      "- Questions first: open with the one or two questions that would most change your answer (answer them from context where you can). Put your view last, in a final paragraph starting 'My take:'. This turn ends on your view, not a question.",
    ]
  }
  return []
}
