import { neutraliseFences } from '@/lib/kairos/_prompt-utils'
import { GOAL_DUE_MAX_DAYS, GOAL_DUE_MIN_DAYS } from './parse'

// goal_propose prompt (Phase 2, Track A). The model may propose at most one
// investigation goal, seeded only from the listed ideas and failed goals.

export const GOAL_PROPOSE_MAX_OUTPUT_TOKENS = 1500

export const GOAL_PROPOSE_SYSTEM_PROMPT = [
  'You are Kairos, deciding whether to propose ONE goal of your own to the owner for tonight.',
  'A goal is an INVESTIGATION: a question you will look into and report back on. It never changes anything, sends anything or acts in the world.',
  'Proposing nothing is a good answer. Only propose when a seed below clearly deserves a deeper look.',
  '',
  'Rules:',
  '- Ground it in one or more seeds: copy their ids verbatim into seedIds. Never invent ids.',
  '- "question" is one real question ending with "?". "title" is a short noun phrase, not an instruction.',
  '- "successCheck" says how the owner will know it is done (they confirm it themselves).',
  `- "dueInDays" is a whole number from ${GOAL_DUE_MIN_DAYS} to ${GOAL_DUE_MAX_DAYS}.`,
  '- "dominionId" is one of the listed area ids, or null.',
  '- Do not duplicate an open objective or an open goal.',
  '- Never make a goal about yourself or your own machinery: your memory, continuity, permissions, schedule, budget, constitution, routines or prompts.',
  '',
  'Answer with exactly one JSON object and nothing else:',
  '{"goal": null}',
  'or',
  '{"goal": {"title": "...", "question": "...?", "why": "...", "seedIds": ["..."], "successCheck": "...", "dueInDays": 7, "dominionId": null}}',
].join('\n')

export interface GoalPromptSeed {
  id: string
  kind: 'idea' | 'failed_goal'
  title: string
  text: string
}

export interface GoalPromptInputs {
  date: string
  seeds: readonly GoalPromptSeed[]
  dominions: ReadonlyArray<{ id: string; name: string }>
  objectives: ReadonlyArray<{ title: string; dominion: string }>
  openGoals: readonly string[]
}

const clip = (s: string, n: number) => neutraliseFences(s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function buildGoalProposePrompt(inputs: GoalPromptInputs): string {
  const seedLabel = (k: GoalPromptSeed['kind']) => (k === 'idea' ? 'accepted idea' : 'failed goal')
  return [
    `Date: ${inputs.date}`,
    '',
    '## Seeds (the only ids you may cite)',
    ...inputs.seeds.map((s) => `- [${s.id}] (${seedLabel(s.kind)}) ${clip(s.title, 160)} — ${clip(s.text, 400)}`),
    '',
    '## Areas',
    ...(inputs.dominions.length ? inputs.dominions.map((d) => `- [${d.id}] ${clip(d.name, 80)}`) : ['- (none)']),
    '',
    '## Open objectives (do not duplicate)',
    ...(inputs.objectives.length ? inputs.objectives.map((o) => `- ${clip(o.title, 160)} (${clip(o.dominion, 60)})`) : ['- (none)']),
    '',
    '## Open goals (do not duplicate)',
    ...(inputs.openGoals.length ? inputs.openGoals.map((g) => `- ${clip(g, 160)}`) : ['- (none)']),
  ].join('\n')
}
