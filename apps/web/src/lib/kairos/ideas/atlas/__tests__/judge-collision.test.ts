import { describe, expect, it } from 'vitest'
import {
  IDEA_JUDGE_COLLISION_RULE,
  IDEA_JUDGE_SYSTEM_PROMPT,
  buildIdeaJudgePrompt,
  collisionLine,
  parseIdeaJudgeText,
} from '../../judge-prompt'
import { buildJudgeSpec, contenders, readJudgeContext, type IdeaJudgeContext } from '../../judge-context'
import { scheduleMatches } from '../../pairing'
import type { IdeaBridgeMeta } from '../../types'

// Lane B2 judge confirmation lives in lane A's judge prompt/context: the
// collision rule and line appear only when a contender carries a bridge.

const novelty = { class: 'novel' as const, maxCosine: 0.2, nearestId: null, nearestKind: null }
const bridge: IdeaBridgeMeta = {
  v: 1, pairKey: 'mA|mB', aId: 'mem-a', bId: 'mem-b', aArea: 'dom-1', bArea: 'dom-2', cos: 0.3,
  relations: [{ a: 'deploys wait on review', b: 'workouts wait on sleep' }],
  map: [{ a: 'review', b: 'sleep' }, { a: 'deploy <<<x>>>', b: 'workout' }],
  insight: 'gate the heavy thing on the recovery thing', mappingHolds: null,
}
const cand = (key: string, extra: Record<string, unknown> = {}) => ({
  key, direction: 'Stop', title: `T ${key}`, claim: `claim ${key}`, why: 'w', nextStep: 's', citedIds: ['e1'], novelty, evidenceIds: ['e1'], vector: null, ...extra,
})
const evidence = { e1: { id: 'e1', title: 'Ev', text: 'x', origin: 'operator', dominionId: null } }

function ctx(bridged: boolean): IdeaJudgeContext {
  const s = scheduleMatches(['c1', 'c2'])
  const raw = { date: '2026-10-01', generateJobId: 'g', candidates: [cand('c1', bridged ? { bridge } : {}), cand('c2')], evidence, nearest: {}, pairs: s.pairs, matches: s.matches }
  return readJudgeContext(raw) as IdeaJudgeContext
}

const answer = (mappingHolds: unknown) => '```json\n' + JSON.stringify({
  critiques: [
    { key: 'c1', verdict: 'grounded', supports: ['e1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '', mappingHolds },
    { key: 'c2', verdict: 'grounded', supports: ['e1'], contradicts: [], alreadyKnown: false, meaningfullyDifferent: null, note: '', mappingHolds: false },
  ],
  votes: [],
}) + '\n```'

describe('B2 collision confirmation in the judge', () => {
  it('no bridge → system and prompt exactly as before; mappingHolds never set', () => {
    const c = ctx(false)
    const spec = buildJudgeSpec(c)
    expect(spec.input.system).toBe(IDEA_JUDGE_SYSTEM_PROMPT)
    expect(spec.input.prompt).toBe(buildIdeaJudgePrompt({ date: c.date, candidates: contenders(c), evidence, nearest: {}, matches: c.matches }))
    expect(spec.input.prompt).not.toContain('Collision:')
    const judged = parseIdeaJudgeText(answer(false), { candidates: contenders(c), matches: c.matches })
    for (const cr of judged.critiques.values()) expect(cr).not.toHaveProperty('mappingHolds')
  })

  it('a bridged contender adds the rule and its collision line (data-sanitised)', () => {
    const spec = buildJudgeSpec(ctx(true))
    expect(spec.input.system).toBe(`${IDEA_JUDGE_SYSTEM_PROMPT}\n${IDEA_JUDGE_COLLISION_RULE}`)
    const line = 'Collision: [mem-a] ↔ [mem-b]; relations: deploys wait on review ⇄ workouts wait on sleep; mapping: review ⇄ sleep; deploy "x" ⇄ workout; insight: gate the heavy thing on the recovery thing'
    expect(collisionLine(bridge)).toBe(line)
    expect(spec.input.prompt).toContain(`Next step: s\n${line}\nEvidence:`)
    expect(spec.input.prompt.split('Collision:')).toHaveLength(2)
  })

  it('mappingHolds is kept only for bridged candidates (missing → null)', () => {
    const c = ctx(true)
    const parse = (v: unknown) => parseIdeaJudgeText(answer(v), { candidates: contenders(c), matches: c.matches })
    expect(parse(false).critiques.get('c1')?.mappingHolds).toBe(false)
    expect(parse(true).critiques.get('c1')?.mappingHolds).toBe(true)
    expect(parse(undefined).critiques.get('c1')?.mappingHolds).toBeNull()
    expect(parse(false).critiques.get('c2')).not.toHaveProperty('mappingHolds')
  })
})
