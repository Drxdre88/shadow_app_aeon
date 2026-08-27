import { describe, it, expect } from 'vitest'
import {
  HANGAR_MODEL_RE,
  hangarAgentSchema,
  agentSessionEngineSchema,
  hangarCardMetadataSchema,
  hangarCardDraftSchema,
  hangarResultEnvelopeSchema,
  createHangarRepoSchema,
  sessionEventsTailSchema,
} from '../validators'

// The Hangar card metadata is operator-supplied and ends up on a runner's CLI
// argv. These are the boundary tests for that trust edge: anything that could
// be read as a flag has to be rejected at the schema, not at the runner.

const MISSION = {
  objective: 'implement',
  repo: 'aeon',
  instruction: 'Ship the thing.',
}

describe('HANGAR_MODEL_RE', () => {
  it.each([
    'claude-sonnet-5',
    'gpt-5.6-sol',
    'claude-opus-5',
    'anthropic:claude-haiku-4-5-20251001',
    'o3',
  ])('accepts a real model id: %s', (id) => {
    expect(HANGAR_MODEL_RE.test(id)).toBe(true)
  })

  it.each([
    '--dangerously-skip-permissions',
    '-p',
    '-',
    '.hidden-flag',
    ':colon-lead',
    '_underscore',
  ])('rejects a flag-shaped id: %s', (id) => {
    expect(HANGAR_MODEL_RE.test(id)).toBe(false)
  })

  it.each([
    'claude sonnet',
    'claude;rm -rf /',
    'claude$(whoami)',
    "claude'--flag",
    'claude`id`',
    'claude|tee',
    'claude\nnewline',
  ])('rejects shell metacharacters: %j', (id) => {
    expect(HANGAR_MODEL_RE.test(id)).toBe(false)
  })
})

describe('hangarCardMetadataSchema', () => {
  it('rejects a model that leads with a dash', () => {
    const parsed = hangarCardMetadataSchema.safeParse({ ...MISSION, model: '--dangerously-skip-permissions' })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0].message).toBe('Invalid model id')
  })

  it('accepts a normal model id', () => {
    const parsed = hangarCardMetadataSchema.safeParse({ ...MISSION, model: 'claude-sonnet-5' })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.model).toBe('claude-sonnet-5')
  })

  it('materialises defaults from a minimal mission', () => {
    const parsed = hangarCardMetadataSchema.parse(MISSION)
    expect(parsed).toMatchObject({
      agent: 'copilot',
      outputMode: 'auto',
      subagents: [],
      sessionIds: [],
    })
  })

  // Drop-to-launch consent: a mission is only allowed to fire on a column
  // move if the operator armed THIS card. Default-on would mean every
  // mission card launches the moment it is dragged into the wrong column.
  it('auto-run defaults to OFF', () => {
    expect(hangarCardMetadataSchema.parse(MISSION).autoRun).toBe(false)
  })

  it('auto-run only accepts a real boolean', () => {
    expect(hangarCardMetadataSchema.parse({ ...MISSION, autoRun: true }).autoRun).toBe(true)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, autoRun: 'yes' }).success).toBe(false)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, autoRun: 1 }).success).toBe(false)
  })

  // The repo slug reaches the runner's argv and a host path lookup, so it
  // gets the same treatment as the model id.
  it.each(['aeon', 'arq', 'shadow-data', 'org/repo', 'repo.v2'])(
    'accepts a real repo slug: %s',
    (repo) => {
      expect(hangarCardMetadataSchema.safeParse({ ...MISSION, repo }).success).toBe(true)
    }
  )

  it.each(['-rf', '--force', '../sibling', 'repo; rm -rf /', 'repo name', '$(whoami)', ''])(
    'rejects a dangerous repo slug: %s',
    (repo) => {
      expect(hangarCardMetadataSchema.safeParse({ ...MISSION, repo }).success).toBe(false)
    }
  )

  it('rejects a forged, non-uuid session id', () => {
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, sessionIds: ['forged-id'] }).success).toBe(false)
  })
})

// The editor's write path. Everything a client sends to saveCardMission goes
// through here, so this is where forged system fields have to die.
describe('hangarCardDraftSchema', () => {
  const DRAFT = {
    objective: 'implement',
    repo: 'arq',
    agent: 'copilot',
    model: null,
    instruction: 'add a hello print',
    outputMode: 'auto',
    autoRun: false,
  }

  it('accepts a half-filled draft the strict schema would reject', () => {
    expect(hangarCardDraftSchema.safeParse({ ...DRAFT, repo: '', instruction: '' }).success).toBe(true)
    expect(hangarCardMetadataSchema.safeParse({ ...DRAFT, repo: '', instruction: '' }).success).toBe(false)
  })

  it('strips system-written fields so a client cannot forge launch history', () => {
    const parsed = hangarCardDraftSchema.parse({
      ...DRAFT,
      sessionIds: ['00000000-0000-4000-8000-000000000000'],
      lastResult: { status: 'completed' },
      lastLaunchedAt: '1999-01-01T00:00:00.000Z',
    }) as Record<string, unknown>
    expect(parsed.sessionIds).toBeUndefined()
    expect(parsed.lastResult).toBeUndefined()
    expect(parsed.lastLaunchedAt).toBeUndefined()
  })

  it('still refuses a flag-shaped repo or model in a draft', () => {
    expect(hangarCardDraftSchema.safeParse({ ...DRAFT, repo: '--force' }).success).toBe(false)
    expect(hangarCardDraftSchema.safeParse({ ...DRAFT, model: '--dangerously-skip-permissions' }).success).toBe(false)
  })

  it('accepts a 1-character instruction and rejects an empty one', () => {
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, instruction: 'x' }).success).toBe(true)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, instruction: '' }).success).toBe(false)
  })

  it('accepts a 20000-character instruction and rejects 20001', () => {
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, instruction: 'x'.repeat(20_000) }).success).toBe(true)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, instruction: 'x'.repeat(20_001) }).success).toBe(false)
  })

  it('accepts 20 subagents and rejects 21', () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `agent-${i}`)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, subagents: names(20) }).success).toBe(true)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, subagents: names(21) }).success).toBe(false)
  })

  it('rejects an unknown objective or agent', () => {
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, objective: 'refactor' }).success).toBe(false)
    expect(hangarCardMetadataSchema.safeParse({ ...MISSION, agent: 'cursor' }).success).toBe(false)
  })
})

describe('engine enum is a single source of truth', () => {
  it('hangarAgentSchema IS agentSessionEngineSchema', () => {
    expect(hangarAgentSchema).toBe(agentSessionEngineSchema)
  })

  it('a card agent, a session engine and a repo allow-list accept the same values', () => {
    for (const engine of agentSessionEngineSchema.options) {
      expect(hangarCardMetadataSchema.safeParse({ ...MISSION, agent: engine }).success).toBe(true)
      expect(createHangarRepoSchema.shape.allowedEngines.safeParse([engine]).success).toBe(true)
    }
    expect(createHangarRepoSchema.shape.allowedEngines.safeParse(['cursor']).success).toBe(false)
  })
})

describe('hangarResultEnvelopeSchema', () => {
  const ENVELOPE = { status: 'completed', outcome: 'implemented', summary: 'Done.' }

  it('accepts the three terminal statuses', () => {
    for (const status of ['completed', 'needs_input', 'failed']) {
      expect(hangarResultEnvelopeSchema.safeParse({ ...ENVELOPE, status }).success).toBe(true)
    }
  })

  it("rejects the invented status 'complete'", () => {
    expect(hangarResultEnvelopeSchema.safeParse({ ...ENVELOPE, status: 'complete' }).success).toBe(false)
  })

  it('requires status, outcome and summary', () => {
    expect(hangarResultEnvelopeSchema.safeParse({}).success).toBe(false)
    expect(hangarResultEnvelopeSchema.safeParse({ status: 'completed' }).success).toBe(false)
  })

  it('rejects a bad tests status inside the nested block', () => {
    expect(hangarResultEnvelopeSchema.safeParse({
      ...ENVELOPE,
      tests: { status: 'green' },
    }).success).toBe(false)
    expect(hangarResultEnvelopeSchema.safeParse({
      ...ENVELOPE,
      tests: { status: 'passed', summary: '42 passed' },
    }).success).toBe(true)
  })
})

describe('sessionEventsTailSchema', () => {
  it('rejects non-numeric, zero, negative and oversized limits', () => {
    expect(sessionEventsTailSchema.safeParse({ limit: 'abc' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ limit: '0' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ limit: '501' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ limit: '-5' }).success).toBe(false)
  })

  it('defaults limit to 500 when absent and accepts in-range values', () => {
    const parsed = sessionEventsTailSchema.parse({})
    expect(parsed.limit).toBe(500)
    expect(parsed.afterSeq).toBeUndefined()
    expect(sessionEventsTailSchema.parse({ limit: '250', afterSeq: '10' })).toEqual({ limit: 250, afterSeq: 10 })
  })

  it('allows afterSeq -1 (everything) but rejects below and non-integers', () => {
    expect(sessionEventsTailSchema.parse({ afterSeq: '-1' }).afterSeq).toBe(-1)
    expect(sessionEventsTailSchema.safeParse({ afterSeq: '-2' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ afterSeq: '1.5' }).success).toBe(false)
    expect(sessionEventsTailSchema.safeParse({ afterSeq: 'abc' }).success).toBe(false)
  })
})
