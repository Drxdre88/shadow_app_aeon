import {
  GOAL_CHECK_MAX,
  GOAL_DUE_MAX_DAYS,
  GOAL_DUE_MIN_DAYS,
  GOAL_QUESTION_MAX,
  GOAL_TITLE_MAX,
  GOAL_WHY_MAX,
  type GoalCandidate,
} from './parse'

// Goal policy (Phase 2, Track A). Pure and fail-closed: anything it cannot
// positively clear is rejected with a named reason. The open-goal cap is
// re-checked under the advisory lock at write time, not here.

export const GOAL_NOVELTY_COSINE = 0.88

export type GoalPolicyReason =
  | 'forbidden_topic'
  | 'not_an_investigation'
  | 'bad_length'
  | 'due_out_of_range'
  | 'unknown_seed'
  | 'unknown_dominion'
  | 'duplicate_goal'
  | 'duplicates_objective'
  | 'novelty_unchecked'

export type GoalPolicyResult = { ok: true } | { ok: false; reason: GoalPolicyReason; detail: string }

export interface GoalPolicyContext {
  validSeedIds: ReadonlySet<string>
  validDominionIds: ReadonlySet<string>
  openObjectiveTitles: readonly string[]
  // Highest cosine against active, pending and recently vetoed goals; null
  // when it could not be measured (no embedding) — that fails closed.
  nearestSimilarity: number | null
}

// Self-governance and Kairos's own machinery are never a goal topic.
const FORBIDDEN_TOPICS: ReadonlyArray<[string, RegExp]> = [
  ['continuity', /\bcontinuity\b/i],
  ['permissions', /\b(permissions?|access rights|access control|privileges?)\b/i],
  ['schedule', /\b(schedul\w*|cron\w*)\b/i],
  ['budget', /\b(budget\w*|spend\w*|billing|paid key|api key|credits?)\b/i],
  ['memory', /\bmemor(y|ies)\b/i],
  ['constitution', /\bconstitution\w*\b/i],
  ['kairos', /\bkairos\b/i],
  ['machinery', /\b(routines?|thinking (jobs?|queue)|system prompts?|prompts?|self[- ]?(improv\w*|modif\w*|govern\w*)|autonom\w*|my own (mind|brain|goals?|rules?))\b/i],
]

const ACTION_VERBS = new Set([
  'add', 'automate', 'book', 'build', 'buy', 'cancel', 'change', 'commit', 'configure', 'create', 'delete', 'deploy',
  'disable', 'email', 'enable', 'fix', 'implement', 'install', 'launch', 'merge', 'message', 'migrate', 'move', 'order',
  'pay', 'publish', 'push', 'refactor', 'remove', 'rename', 'replace', 'rewrite', 'run', 'schedule', 'send', 'set',
  'ship', 'start', 'stop', 'update', 'upgrade', 'write',
])

const QUESTION_OPENERS = new Set([
  'what', 'why', 'how', 'which', 'when', 'where', 'who', 'whom', 'whose', 'is', 'are', 'does', 'do', 'did', 'can',
  'could', 'should', 'would', 'will', 'has', 'have', 'was', 'were', 'to',
])

const firstWord = (s: string) => (s.trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? '')
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Shared with Horae (agenda/rules.ts): the first forbidden topic named in
// `text`, or null.
export function findForbiddenTopic(text: string): string | null {
  for (const [topic, re] of FORBIDDEN_TOPICS) {
    if (re.test(text)) return topic
  }
  return null
}

// Shared with Horae: `text` opens with an action verb (an act, not a check).
export function startsWithActionVerb(text: string): boolean {
  return ACTION_VERBS.has(firstWord(text))
}

function lengthProblem(c: GoalCandidate): string | null {
  const limits: Array<[keyof GoalCandidate, number, number]> = [
    ['title', 8, GOAL_TITLE_MAX],
    ['question', 12, GOAL_QUESTION_MAX],
    ['why', 12, GOAL_WHY_MAX],
    ['successCheck', 8, GOAL_CHECK_MAX],
  ]
  for (const [field, min, max] of limits) {
    const len = String(c[field] ?? '').trim().length
    if (len < min || len > max) return `${field} length ${len} outside ${min}–${max}`
  }
  return null
}

export function checkGoalPolicy(c: GoalCandidate, ctx: GoalPolicyContext): GoalPolicyResult {
  const reject = (reason: GoalPolicyReason, detail: string): GoalPolicyResult => ({ ok: false, reason, detail })

  const length = lengthProblem(c)
  if (length) return reject('bad_length', length)

  const text = [c.title, c.question, c.why, c.successCheck].join('\n')
  const topic = findForbiddenTopic(text)
  if (topic) return reject('forbidden_topic', topic)

  if (startsWithActionVerb(c.title)) return reject('not_an_investigation', `title starts with "${firstWord(c.title)}"`)
  if (!c.question.trim().endsWith('?') || !QUESTION_OPENERS.has(firstWord(c.question))) {
    return reject('not_an_investigation', 'question is not a question')
  }

  if (!Number.isInteger(c.dueInDays) || c.dueInDays < GOAL_DUE_MIN_DAYS || c.dueInDays > GOAL_DUE_MAX_DAYS) {
    return reject('due_out_of_range', `dueInDays ${c.dueInDays}`)
  }

  if (c.seedIds.length === 0 || new Set(c.seedIds).size !== c.seedIds.length || !c.seedIds.every((id) => ctx.validSeedIds.has(id))) {
    return reject('unknown_seed', 'every seed must be a listed id, once')
  }
  if (c.dominionId !== null && !ctx.validDominionIds.has(c.dominionId)) return reject('unknown_dominion', c.dominionId)

  const title = normalise(c.title)
  for (const objective of ctx.openObjectiveTitles) {
    const o = normalise(objective)
    if (o.length >= 8 && (title === o || title.includes(o) || o.includes(title))) return reject('duplicates_objective', objective)
  }

  if (ctx.nearestSimilarity === null || !Number.isFinite(ctx.nearestSimilarity)) return reject('novelty_unchecked', 'no embedding')
  if (ctx.nearestSimilarity >= GOAL_NOVELTY_COSINE) return reject('duplicate_goal', `cosine ${ctx.nearestSimilarity.toFixed(3)}`)

  return { ok: true }
}
