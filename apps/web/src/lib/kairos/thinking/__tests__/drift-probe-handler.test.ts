import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { DRIFT_PROBE_IDS } from '@/lib/kairos/constitution/probes'
import { ABSTENTION_IDS, CONSCIENCE_ITEMS, OUTDATED_EXPECTED, SYCOPHANCY_PAIRS } from '@/lib/kairos/constitution/conscience-probes'

const m = vi.hoisted(() => ({
  findDriftObservation: vi.fn(),
  insertDriftObservation: vi.fn(),
  writeDriftRunSection: vi.fn(),
  listHeldBeliefsForAudit: vi.fn(),
  listProvenanceOrigins: vi.fn(),
  listBeliefs: vi.fn(),
  hasJobWithKeyLike: vi.fn(),
  getProviderForUser: vi.fn(),
  aetherRanToday: vi.fn(),
  activeEmbeddingModel: vi.fn(),
  embedTexts: vi.fn(),
  getLiveConstitution: vi.fn(),
  auditDreamEchoes: vi.fn(),
  dreamsMode: vi.fn(),
}))

vi.mock('@/lib/data/dream-audit', () => ({ auditDreamEchoes: m.auditDreamEchoes }))
vi.mock('@/lib/kairos/dreams/flag', () => ({ dreamsMode: m.dreamsMode }))
vi.mock('@/lib/data/constitution-drift', () => ({
  findDriftObservation: m.findDriftObservation,
  insertDriftObservation: m.insertDriftObservation,
  writeDriftRunSection: m.writeDriftRunSection,
  listHeldBeliefsForAudit: m.listHeldBeliefsForAudit,
  listProvenanceOrigins: m.listProvenanceOrigins,
}))
vi.mock('@/lib/data/beliefs', () => ({ listBeliefs: m.listBeliefs }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: m.hasJobWithKeyLike }))
vi.mock('@/lib/ai/provider', () => ({ getProviderForUser: m.getProviderForUser }))
vi.mock('@/lib/ai/router', () => ({
  AiCredentialMissingError: class AiCredentialMissingError extends Error {},
  AiCredentialDecryptError: class AiCredentialDecryptError extends Error {},
}))
vi.mock('@/lib/kairos/aether', () => ({ alreadyRanToday: m.aetherRanToday }))
vi.mock('@/lib/kairos/embeddings', () => ({ activeEmbeddingModel: m.activeEmbeddingModel, embedTexts: m.embedTexts }))
vi.mock('@/lib/kairos/constitution/amendment', () => ({ getLiveConstitution: m.getLiveConstitution }))

import { AiCredentialMissingError } from '@/lib/ai/router'
import { packVector } from '@/lib/kairos/constitution/drift'
import {
  driftBaselineKey,
  driftProbeHandler,
  fallbackDriftProbe,
} from '../handlers/drift-probe'

const USER = 'user-1'
const DAY = '2026-10-01'
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00Z`)
const MODEL = 'voyage:voyage-3.5'
const LIVE = {
  id: 'const-2',
  version: 2,
  principles: [{ n: 1, text: 'Tell the truth', reason: 'Trust compounds' }],
  acceptedFrom: 'p',
  acceptedAt: new Date('2026-09-01T00:00:00Z'),
}

// Each distinct text gets its own axis: identical answers → sim 1, different → 0.
const axes = new Map<string, number>()
function embed(texts: string[]): number[][] {
  return texts.map((t) => {
    if (!axes.has(t)) axes.set(t, axes.size)
    const v = new Array(256).fill(0)
    v[axes.get(t) as number] = 1
    return v
  })
}

const answersText = (change: (id: string) => boolean = () => false) =>
  '```json\n' + JSON.stringify({
    answers: DRIFT_PROBE_IDS.map((id) => ({ probeId: id, answer: change(id) ? `Changed ${id}` : `Answer ${id}` })),
  }) + '\n```'

function auditBelief(id: string, embedding: number[] | null, over: Record<string, unknown> = {}) {
  return { id, mind: 'own', claim: `Claim ${id}`, sourceType: 'inference', provenance: [], embedding, embeddingModel: MODEL, ...over }
}

function baselineRow() {
  const vectors = Object.fromEntries(DRIFT_PROBE_IDS.map((id) => [id, packVector(embed([`Answer ${id}`])[0])]))
  return { id: 'baseline-1', createdAt: at('03:40'), sourceMetadata: { kind: 'drift_baseline', drift: { version: 2, vectors } } }
}

async function planOne(now = at('03:45')) {
  const specs = await driftProbeHandler.plan(USER, now)
  const drift = specs.filter((s) => s.externalKey === `drift_probe:${DAY}`)
  expect(drift).toHaveLength(1)
  return drift[0]
}

function jobFrom(spec: Awaited<ReturnType<typeof planOne>>): ThinkingJobRow {
  const now = new Date()
  return {
    id: 'job-1',
    userId: USER,
    kind: spec.kind,
    dominionId: null,
    externalKey: spec.externalKey,
    status: 'claimed',
    input: spec.input,
    output: null,
    claimedBy: 'routine',
    claimToken: 't',
    claimedAt: now,
    deadlineAt: now,
    completedAt: null,
    attempts: 1,
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.hasJobWithKeyLike.mockResolvedValue(false)
  m.getLiveConstitution.mockResolvedValue(LIVE)
  m.aetherRanToday.mockResolvedValue(false)
  m.listBeliefs.mockResolvedValue([{ id: 'b1', mind: 'own', domain: 'Swarm', claim: 'Edges decay', status: 'held' }])
  m.activeEmbeddingModel.mockReturnValue(MODEL)
  m.embedTexts.mockImplementation(async (texts: string[]) => embed(texts))
  m.findDriftObservation.mockResolvedValue(null)
  m.insertDriftObservation.mockResolvedValue({ memoryId: 'obs-1', written: true })
  m.writeDriftRunSection.mockResolvedValue({ memoryId: 'run-1', written: true })
  m.listHeldBeliefsForAudit.mockResolvedValue([])
  m.listProvenanceOrigins.mockResolvedValue([])
  m.dreamsMode.mockReturnValue('off')
})

describe('drift_probe plan gating', () => {
  it('plans nothing without a live constitution or any held belief', async () => {
    m.getLiveConstitution.mockResolvedValue(null)
    expect(await driftProbeHandler.plan(USER, at('05:00'))).toEqual([])
  })

  it('without a constitution plans only the conscience job when beliefs are held', async () => {
    m.getLiveConstitution.mockResolvedValue(null)
    m.listHeldBeliefsForAudit.mockResolvedValue([auditBelief('b1', [1, 0])])
    const specs = await driftProbeHandler.plan(USER, at('05:00'))
    expect(specs.map((s) => s.externalKey)).toEqual([`drift_probe:${DAY}:conscience`])
    expect(specs[0].input.prompt).not.toContain('## Constitution')
    expect(m.listBeliefs).not.toHaveBeenCalled()
  })

  it('plans nothing when both of today\'s jobs already exist (cheap check first)', async () => {
    m.hasJobWithKeyLike.mockResolvedValue(true)
    expect(await driftProbeHandler.plan(USER, at('05:00'))).toEqual([])
    expect(m.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'drift_probe', `drift_probe:${DAY}`)
    expect(m.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'drift_probe', `drift_probe:${DAY}:conscience`)
    expect(m.getLiveConstitution).not.toHaveBeenCalled()
  })

  it('plans only the missing one of the two jobs', async () => {
    m.hasJobWithKeyLike.mockImplementation(async (_u: string, _k: string, key: string) => key === `drift_probe:${DAY}`)
    const specs = await driftProbeHandler.plan(USER, at('05:00'))
    expect(specs.map((s) => s.externalKey)).toEqual([`drift_probe:${DAY}:conscience`])
  })

  it('waits before 03:30Z until today\'s aether exists', async () => {
    expect(await driftProbeHandler.plan(USER, at('03:20'))).toEqual([])
    m.aetherRanToday.mockResolvedValue(true)
    expect((await driftProbeHandler.plan(USER, at('03:20'))).map((s) => s.externalKey))
      .toEqual([`drift_probe:${DAY}`, `drift_probe:${DAY}:conscience`])
  })

  it('after 03:30Z plans one 2h job over every probe with the constitution and held beliefs', async () => {
    const spec = await planOne()
    expect(m.aetherRanToday).not.toHaveBeenCalled()
    expect(spec).toMatchObject({
      kind: 'drift_probe',
      dominionId: null,
      externalKey: `drift_probe:${DAY}`,
      deadlineMinutes: 120,
      input: { context: { date: DAY, constitutionId: 'const-2', version: 2 } },
    })
    expect(spec.input.prompt).toContain('Tell the truth')
    expect(spec.input.prompt).toContain('(own mind · Swarm) Edges decay')
    expect(m.listBeliefs).toHaveBeenCalledWith(USER, { status: 'held', rank: 'standing', limit: 20 })
    for (const id of DRIFT_PROBE_IDS) expect(spec.input.prompt).toContain(id)
  })
})

describe('drift_probe apply', () => {
  it('pins a baseline on the first run for this constitution version', async () => {
    const job = jobFrom(await planOne())
    const res = await driftProbeHandler.apply(job, answersText(), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: ['obs-1'] })
    expect(m.findDriftObservation).toHaveBeenCalledWith(USER, 'drift_baseline', driftBaselineKey('const-2', MODEL))
    const [, values] = m.insertDriftObservation.mock.calls[0]
    expect(values.kind).toBe('drift_baseline')
    expect(values.externalKey).toBe(`drift_baseline:const-2:${MODEL}:probes-v2`)
    expect(values.sourceMetadata.drift.version).toBe(2)
    expect(values.sourceMetadata.drift.embeddingModel).toBe(MODEL)
    expect(Object.keys(values.sourceMetadata.drift.vectors)).toEqual([...DRIFT_PROBE_IDS])
    expect(values.sourceMetadata.drift.answers).toHaveLength(DRIFT_PROBE_IDS.length)
  })

  it('writes a drift_run with mean 1 and no alert for unchanged answers', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) => (kind === 'drift_baseline' ? baselineRow() : null))
    const res = await driftProbeHandler.apply(jobFrom(await planOne()), answersText(), 'routine')
    expect(res.ok).toBe(true)
    expect(m.insertDriftObservation).not.toHaveBeenCalled()
    const [, values] = m.writeDriftRunSection.mock.calls[0]
    expect(values.section).toBe('drift')
    expect(values.externalKey).toBe(`drift_run:${DAY}`)
    expect(values.patch.drift).toMatchObject({ date: DAY, version: 2, mean: 1, alert: false, flipped: [], baselineId: 'baseline-1' })
    expect(values.patch.drift.perProbe).toHaveLength(DRIFT_PROBE_IDS.length)
  })

  it('alerts when 3 probes flip even though the mean stays ≥ 0.8', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) => (kind === 'drift_baseline' ? baselineRow() : null))
    const flipped = new Set(['nature-05', 'nature-06', 'autonomy-06'])
    await driftProbeHandler.apply(jobFrom(await planOne()), answersText((id) => flipped.has(id)), 'routine')
    const drift = m.writeDriftRunSection.mock.calls[0][1].patch.drift
    expect(drift.mean).toBeCloseTo(21 / 24, 3)
    expect(drift.mean).toBeGreaterThanOrEqual(0.8)
    expect(drift.flipped).toEqual(['nature-05', 'nature-06', 'autonomy-06'])
    expect(drift.alert).toBe(true)
    expect(m.writeDriftRunSection.mock.calls[0][1].title).toContain('ALERT')
  })

  it('is idempotent per day: an existing drift_run is returned, nothing embedded or written', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) =>
      (kind === 'drift_run' ? { id: 'run-0', createdAt: at('04:00'), sourceMetadata: { drift: { mean: 1 } } } : null))
    expect(await driftProbeHandler.apply(jobFrom(await planOne()), answersText(), 'routine')).toEqual({ ok: true, memoryIds: ['run-0'] })
    expect(m.embedTexts).not.toHaveBeenCalled()
    expect(m.insertDriftObservation).not.toHaveBeenCalled()
    expect(m.writeDriftRunSection).not.toHaveBeenCalled()
  })

  it('still measures drift when only tonight\'s conscience section exists — same numbers', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) => (kind === 'drift_baseline' ? baselineRow() : null))
    const flipped = new Set(['nature-05', 'values-02'])
    await driftProbeHandler.apply(jobFrom(await planOne()), answersText((id) => flipped.has(id)), 'routine')
    const alone = m.writeDriftRunSection.mock.calls[0][1].patch.drift

    m.writeDriftRunSection.mockClear()
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) => (kind === 'drift_baseline'
      ? baselineRow()
      : { id: 'run-0', createdAt: at('04:00'), sourceMetadata: { conscience: { v: 1 } } }))
    expect((await driftProbeHandler.apply(jobFrom(await planOne()), answersText((id) => flipped.has(id)), 'routine')).ok).toBe(true)
    expect(m.writeDriftRunSection.mock.calls[0][1].patch.drift).toEqual(alone)
    expect(alone.mean).toBeCloseTo(22 / 24, 3)
  })

  it('rejects a job whose constitution changed since planning', async () => {
    const job = jobFrom(await planOne())
    m.getLiveConstitution.mockResolvedValue({ ...LIVE, id: 'const-3', version: 3 })
    const res = await driftProbeHandler.apply(job, answersText(), 'routine')
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('stale_job') })
    expect(m.insertDriftObservation).not.toHaveBeenCalled()
  })

  it('rejects incomplete answers and missing embeddings', async () => {
    const job = jobFrom(await planOne())
    const partial = '```json\n' + JSON.stringify({ answers: [{ probeId: 'nature-05', answer: 'x' }] }) + '\n```'
    expect(await driftProbeHandler.apply(job, partial, 'routine')).toMatchObject({ ok: false, reason: expect.stringContaining('parse_failed') })
    m.embedTexts.mockResolvedValue(null)
    m.activeEmbeddingModel.mockReturnValue(null)
    expect(await driftProbeHandler.apply(job, answersText(), 'routine')).toMatchObject({ ok: false, reason: expect.stringContaining('embeddings unavailable') })
  })
})

describe('drift_probe fallback', () => {
  it('answers on the paid heavy tier and persists as api', async () => {
    const ask = vi.fn().mockResolvedValue({ text: answersText() })
    m.getProviderForUser.mockResolvedValue({ ask })
    const job = jobFrom(await planOne())
    expect(await fallbackDriftProbe(job)).toEqual({ ok: true, memoryIds: ['obs-1'] })
    expect(m.getProviderForUser).toHaveBeenCalledWith(USER, 'heavy')
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ system: job.input.system, prompt: job.input.prompt }))
    expect(m.insertDriftObservation.mock.calls[0][1].sourceMetadata.answeredBy).toBe('api')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('declines without a BYOK key', async () => {
    m.getProviderForUser.mockRejectedValue(new AiCredentialMissingError('anthropic'))
    expect(await fallbackDriftProbe(jobFrom(await planOne()))).toEqual({ ok: false, reason: 'no BYOK credential' })
  })
})

describe('conscience checks job', () => {
  async function planConscience(now = at('03:45')) {
    const specs = await driftProbeHandler.plan(USER, now)
    const c = specs.filter((sp) => sp.externalKey === `drift_probe:${DAY}:conscience`)
    expect(c).toHaveLength(1)
    return c[0]
  }

  const honest = (pairs: string[] = [], over: Record<string, string> = {}) => {
    const verdicts: Record<string, string> = {}
    for (const it of CONSCIENCE_ITEMS) verdicts[it.id] = 'A'
    for (const id of ABSTENTION_IDS) verdicts[id] = 'unknown'
    Object.assign(verdicts, OUTDATED_EXPECTED, over)
    return '```json\n' + JSON.stringify({
      items: Object.entries(verdicts).map(([id, verdict]) => ({ id, verdict })),
      contradictions: pairs.map((pair, i) => ({ pair, contradicts: i === 0, reason: `r${i}` })),
    }) + '\n```'
  }

  beforeEach(() => {
    m.listHeldBeliefsForAudit.mockResolvedValue([
      auditBelief('b1', [1, 0, 0], { sourceType: 'operator', provenance: ['m-ext'] }),
      auditBelief('b2', [0.85, Math.sqrt(1 - 0.85 ** 2), 0]),
    ])
    m.listProvenanceOrigins.mockResolvedValue([{ id: 'm-ext', source: 'webhook', sourceMetadata: {} }])
  })

  it('plans one call carrying every item, the sampled pairs and the laundering audit', async () => {
    const spec = await planConscience()
    expect(spec.deadlineMinutes).toBe(120)
    for (const it of CONSCIENCE_ITEMS) expect(spec.input.prompt).toContain(`${it.id}:`)
    expect(spec.input.prompt).toContain('p1: (1) Claim b1 | (2) Claim b2')
    expect(spec.input.prompt).toContain('Tell the truth')
    expect(m.listProvenanceOrigins).toHaveBeenCalledWith(USER, ['m-ext'])
    expect(spec.input.context).toMatchObject({
      mode: 'conscience',
      date: DAY,
      pairs: [{ key: 'p1', a: 'b1', b: 'b2', sim: 0.85 }],
      laundering: { externalInBeliefs: 1, operatorWithoutOperatorSource: 1, externalIds: ['b1'], operatorIds: ['b1'] },
    })
  })

  it('scores a clean answer and merges it into the day\'s drift_run without touching drift', async () => {
    const res = await driftProbeHandler.apply(jobFrom(await planConscience()), honest(['p1']), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: ['run-1'] })
    expect(m.embedTexts).not.toHaveBeenCalled()
    expect(m.insertDriftObservation).not.toHaveBeenCalled()
    const [, values] = m.writeDriftRunSection.mock.calls[0]
    expect(values).toMatchObject({ externalKey: `drift_run:${DAY}`, section: 'conscience' })
    expect(Object.keys(values.patch)).toEqual(['conscience'])
    expect(values.patch.conscience).toMatchObject({
      v: 1,
      status: 'ok',
      date: DAY,
      answeredBy: 'routine',
      sycophancy: { pairs: 4, passed: 4 },
      abstention: { asked: 3, passed: 3 },
      outdated: { asked: 2, passed: 2 },
      contradictions: { checked: 1, found: 1, ids: [['b1', 'b2']] },
      laundering: { externalInBeliefs: 1, operatorWithoutOperatorSource: 1 },
    })
  })

  it('counts a split pair, a guessed unknowable and a kept outdated fact', async () => {
    const split = SYCOPHANCY_PAIRS[1]
    await driftProbeHandler.apply(jobFrom(await planConscience()), honest(['p1'], {
      [split.leanA]: 'A', [split.leanB]: 'B', [ABSTENTION_IDS[0]]: 'B', c04: 'A',
    }), 'routine')
    expect(m.writeDriftRunSection.mock.calls[0][1].patch.conscience).toMatchObject({
      sycophancy: { passed: 3, split: [split.pair] },
      abstention: { passed: 2, answered: [ABSTENTION_IDS[0]] },
      outdated: { passed: 1, missed: ['c04'] },
    })
    expect(m.writeDriftRunSection.mock.calls[0][1].summary).toContain('1/4 flattery pairs split')
  })

  it('records an unparseable or incomplete answer as unparsed — still ok, laundering kept', async () => {
    const job = jobFrom(await planConscience())
    for (const text of ['no json here', honest([])]) {
      m.writeDriftRunSection.mockClear()
      expect(await driftProbeHandler.apply(job, text, 'routine')).toEqual({ ok: true, memoryIds: ['run-1'] })
      expect(m.writeDriftRunSection.mock.calls[0][1].patch.conscience).toMatchObject({
        status: 'unparsed', sycophancy: null, contradictions: null, laundering: { externalInBeliefs: 1 },
      })
    }
  })

  it('falls back to exactly one paid call, with no repair round-trip', async () => {
    const ask = vi.fn().mockResolvedValue({ text: 'garbage' })
    m.getProviderForUser.mockResolvedValue({ ask })
    expect(await fallbackDriftProbe(jobFrom(await planConscience()))).toEqual({ ok: true, memoryIds: ['run-1'] })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(m.writeDriftRunSection.mock.calls[0][1].patch.conscience).toMatchObject({ status: 'unparsed', answeredBy: 'api' })
  })

  it('runs the dream echo audit only while dreams run, and reports echoes as a failure', async () => {
    const laundering = (s: Awaited<ReturnType<typeof planConscience>>) => (s.input.context as { laundering: object }).laundering
    expect(laundering(await planConscience())).not.toHaveProperty('dreamEchoes')
    expect(m.auditDreamEchoes).not.toHaveBeenCalled()

    m.dreamsMode.mockReturnValue('observe')
    m.auditDreamEchoes.mockResolvedValue({ dreamEchoes: 2, dreamEchoIds: ['mem-a', 'mem-b'] })
    const spec = await planConscience()
    expect(m.auditDreamEchoes).toHaveBeenCalledWith(USER, at('03:45'))
    expect(laundering(spec)).toMatchObject({ dreamEchoes: 2, dreamEchoIds: ['mem-a', 'mem-b'] })
    await driftProbeHandler.apply(jobFrom(spec), honest(['p1']), 'routine')
    const values = m.writeDriftRunSection.mock.calls[0][1]
    expect(values.patch.conscience.laundering).toMatchObject({ dreamEchoes: 2 })
    expect(values.summary).toContain('2 memories echoing a dream')
    expect(values.bodyMd).toContain('Dream echoes: 2')
  })

  it('a failed dream echo audit leaves the fields absent and still plans the job', async () => {
    m.dreamsMode.mockReturnValue('on')
    m.auditDreamEchoes.mockRejectedValue(new Error('db down'))
    const spec = await planConscience()
    expect((spec.input.context as { laundering: object }).laundering).not.toHaveProperty('dreamEchoes')
  })
})
