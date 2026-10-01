import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'
import { DRIFT_PROBE_IDS } from '@/lib/kairos/constitution/probes'

const m = vi.hoisted(() => ({
  findDriftObservation: vi.fn(),
  insertDriftObservation: vi.fn(),
  listBeliefs: vi.fn(),
  hasJobWithKeyLike: vi.fn(),
  getProviderForUser: vi.fn(),
  aetherRanToday: vi.fn(),
  activeEmbeddingModel: vi.fn(),
  embedTexts: vi.fn(),
  getLiveConstitution: vi.fn(),
}))

vi.mock('@/lib/data/constitution-drift', () => ({
  findDriftObservation: m.findDriftObservation,
  insertDriftObservation: m.insertDriftObservation,
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

function baselineRow() {
  const vectors = Object.fromEntries(DRIFT_PROBE_IDS.map((id) => [id, packVector(embed([`Answer ${id}`])[0])]))
  return { id: 'baseline-1', createdAt: at('03:40'), sourceMetadata: { kind: 'drift_baseline', drift: { version: 2, vectors } } }
}

async function planOne(now = at('03:45')) {
  const specs = await driftProbeHandler.plan(USER, now)
  expect(specs).toHaveLength(1)
  return specs[0]
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
})

describe('drift_probe plan gating', () => {
  it('plans nothing without a live constitution', async () => {
    m.getLiveConstitution.mockResolvedValue(null)
    expect(await driftProbeHandler.plan(USER, at('05:00'))).toEqual([])
  })

  it('plans nothing when today\'s job already exists (cheap check first)', async () => {
    m.hasJobWithKeyLike.mockResolvedValue(true)
    expect(await driftProbeHandler.plan(USER, at('05:00'))).toEqual([])
    expect(m.hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'drift_probe', `drift_probe:${DAY}`)
    expect(m.getLiveConstitution).not.toHaveBeenCalled()
  })

  it('waits before 03:30Z until today\'s aether exists', async () => {
    expect(await driftProbeHandler.plan(USER, at('03:20'))).toEqual([])
    m.aetherRanToday.mockResolvedValue(true)
    expect(await driftProbeHandler.plan(USER, at('03:20'))).toHaveLength(1)
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
    expect(values.externalKey).toBe(`drift_baseline:const-2:${MODEL}`)
    expect(values.sourceMetadata.drift.version).toBe(2)
    expect(values.sourceMetadata.drift.embeddingModel).toBe(MODEL)
    expect(Object.keys(values.sourceMetadata.drift.vectors)).toEqual([...DRIFT_PROBE_IDS])
    expect(values.sourceMetadata.drift.answers).toHaveLength(DRIFT_PROBE_IDS.length)
  })

  it('writes a drift_run with mean 1 and no alert for unchanged answers', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) => (kind === 'drift_baseline' ? baselineRow() : null))
    const res = await driftProbeHandler.apply(jobFrom(await planOne()), answersText(), 'routine')
    expect(res.ok).toBe(true)
    const [, values] = m.insertDriftObservation.mock.calls[0]
    expect(values.kind).toBe('drift_run')
    expect(values.externalKey).toBe(`drift_run:${DAY}`)
    expect(values.sourceMetadata.drift).toMatchObject({ date: DAY, version: 2, mean: 1, alert: false, flipped: [], baselineId: 'baseline-1' })
    expect(values.sourceMetadata.drift.perProbe).toHaveLength(DRIFT_PROBE_IDS.length)
  })

  it('alerts when 3 probes flip even though the mean stays ≥ 0.8', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) => (kind === 'drift_baseline' ? baselineRow() : null))
    const flipped = new Set(['nature-01', 'nature-02', 'autonomy-02'])
    await driftProbeHandler.apply(jobFrom(await planOne()), answersText((id) => flipped.has(id)), 'routine')
    const drift = m.insertDriftObservation.mock.calls[0][1].sourceMetadata.drift
    expect(drift.mean).toBeCloseTo(21 / 24, 3)
    expect(drift.mean).toBeGreaterThanOrEqual(0.8)
    expect(drift.flipped).toEqual(['nature-01', 'nature-02', 'autonomy-02'])
    expect(drift.alert).toBe(true)
    expect(m.insertDriftObservation.mock.calls[0][1].title).toContain('ALERT')
  })

  it('is idempotent per day: an existing drift_run is returned, nothing embedded or written', async () => {
    m.findDriftObservation.mockImplementation(async (_u: string, kind: string) =>
      (kind === 'drift_run' ? { id: 'run-0', createdAt: at('04:00'), sourceMetadata: {} } : null))
    expect(await driftProbeHandler.apply(jobFrom(await planOne()), answersText(), 'routine')).toEqual({ ok: true, memoryIds: ['run-0'] })
    expect(m.embedTexts).not.toHaveBeenCalled()
    expect(m.insertDriftObservation).not.toHaveBeenCalled()
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
    const partial = '```json\n' + JSON.stringify({ answers: [{ probeId: 'nature-01', answer: 'x' }] }) + '\n```'
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
  })

  it('declines without a BYOK key', async () => {
    m.getProviderForUser.mockRejectedValue(new AiCredentialMissingError('anthropic'))
    expect(await fallbackDriftProbe(jobFrom(await planOne()))).toEqual({ ok: false, reason: 'no BYOK credential' })
  })
})
