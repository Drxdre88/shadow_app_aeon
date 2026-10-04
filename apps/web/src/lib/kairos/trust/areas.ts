import type { PredictionTopic } from '@/lib/data/validators/kairos-predictions'

// Area keys and labels for trust: a Dominion id, or `topic:<t>` for a
// prediction topic. resolveTurnArea picks the area a chat turn is about.

export const TOPIC_KEY_PREFIX = 'topic:'

export const TOPIC_LABELS: Record<PredictionTopic, string> = {
  delivery: 'delivery & timing',
  scope: 'scope',
  risk: 'risk',
  people: 'people',
  other: 'other calls',
}

export const topicKey = (topic: PredictionTopic): string => `${TOPIC_KEY_PREFIX}${topic}`

const TOPIC_HINTS: ReadonlyArray<[PredictionTopic, RegExp]> = [
  ['delivery', /\b(deadline|schedul\w*|ship\w*|launch\w*|due|estimate\w*|on time|late|timeline|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week))\b/i],
  ['scope', /\b(scope|feature creep|cut (it|this|back)|too (much|big)|mvp|requirements?)\b/i],
  ['risk', /\b(risk\w*|danger\w*|safe|unsafe|bet|gamble|downside)\b/i],
  ['people', /\b(team|colleague|boss|manager|partner|friend|hire|hiring|family|client|customer)s?\b/i],
]

export interface TrustDominionRef {
  id: string
  name: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Thread Dominion, then a whole-word Dominion name, then topic hints; null when none.
export function resolveTurnArea(
  userBody: string,
  threadDominionId: string | null,
  dominions: readonly TrustDominionRef[],
): string | null {
  if (threadDominionId) return threadDominionId
  const named = dominions
    .filter((d) => d.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length || a.id.localeCompare(b.id))
    .find((d) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(d.name.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(userBody))
  if (named) return named.id
  const hint = TOPIC_HINTS.find(([, re]) => re.test(userBody))
  return hint ? topicKey(hint[0]) : null
}
