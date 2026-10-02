import { describe, expect, it } from 'vitest'
import raw from './model-registry.json'
import {
  CURRENT_MODELS,
  DEFAULT_ROLE_MODEL,
  LEGACY_REMAP,
  MODEL_REGISTRY,
  MODEL_REGISTRY_REVIEWED_AT,
  effortFor,
  engineModels,
  findModel,
  remapLegacyModel,
  type HangarEngine,
} from './models'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ENGINES: HangarEngine[] = ['copilot', 'claude', 'codex']

// Structural invariants only. Calendar age is the freshness checker's job,
// never a reason for this suite to fail.
describe('model registry invariants', () => {
  it('has the documented top-level shape', () => {
    expect(Object.keys(raw).sort()).toEqual(['defaults', 'legacyRemap', 'models', 'reviewedAt'])
    expect(MODEL_REGISTRY_REVIEWED_AT).toMatch(ISO_DATE)
  })

  it('has unique API ids and unique per-engine ids', () => {
    const ids = MODEL_REGISTRY.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const engine of ENGINES) {
      const engineIds = engineModels(engine).map((m) => m.id)
      expect(new Set(engineIds).size, engine).toBe(engineIds.length)
    }
  })

  it('every entry is well-formed', () => {
    for (const m of MODEL_REGISTRY) {
      expect(['anthropic', 'openai', 'google'], m.id).toContain(m.provider)
      expect(['flagship', 'balanced', 'fast', 'coding', 'top'], m.id).toContain(m.role)
      expect(['current', 'legacy'], m.id).toContain(m.status)
      expect(m.label.length, m.id).toBeGreaterThan(0)
      expect(m, m.id).toHaveProperty('released')
      if (m.released !== null) {
        expect(m.released, m.id).toMatch(ISO_DATE)
        expect(m.released <= MODEL_REGISTRY_REVIEWED_AT, `${m.id} released after the review date`).toBe(true)
      }
      if (m.efforts.length === 0) expect(m.defaultEffort, m.id).toBeNull()
      else expect(m.efforts, m.id).toContain(m.defaultEffort)
    }
  })

  it('tier and routine defaults name current models and an effort they accept', () => {
    for (const role of ['heavy', 'standard', 'cheap', 'routine'] as const) {
      const d = DEFAULT_ROLE_MODEL[role]
      const entry = findModel(d.model)
      expect(entry?.status, role).toBe('current')
      expect(entry?.provider, role).toBe(d.provider)
      expect(entry?.efforts, role).toContain(d.effort)
    }
  })

  it('mission and reviewer defaults name a current model by that engine\'s id', () => {
    for (const engine of ENGINES) {
      const d = DEFAULT_ROLE_MODEL.mission[engine]
      const entry = engineModels(engine).find((m) => m.id === d.model)?.entry
      expect(entry, `mission.${engine}`).toBeDefined()
      expect(entry?.efforts, `mission.${engine}`).toContain(d.effort)
    }
    const r = DEFAULT_ROLE_MODEL.reviewer
    const reviewer = engineModels(r.engine).find((m) => m.id === r.model)?.entry
    expect(reviewer?.efforts).toContain(r.effort)
  })

  it('keeps the review cross-model: reviewer vendor differs from the mission vendor', () => {
    const mission = engineModels('copilot').find((m) => m.id === DEFAULT_ROLE_MODEL.mission.copilot.model)?.entry
    const reviewer = engineModels(DEFAULT_ROLE_MODEL.reviewer.engine).find((m) => m.id === DEFAULT_ROLE_MODEL.reviewer.model)?.entry
    expect(reviewer?.provider).not.toBe(mission?.provider)
  })

  it('legacy remap targets are current models and never chain', () => {
    for (const [from, to] of Object.entries(LEGACY_REMAP)) {
      expect(findModel(to)?.status, `${from} -> ${to}`).toBe('current')
      expect(findModel(from)?.status, `${from} is still offered as current`).not.toBe('current')
      expect(Object.hasOwn(LEGACY_REMAP, to), `${to} remaps again`).toBe(false)
    }
  })
})

describe('owner lineup (2026-10-02)', () => {
  it('offers no Opus or Sonnet older than 5.5', () => {
    const claude = CURRENT_MODELS.filter((m) => /opus|sonnet/.test(m.id)).map((m) => m.id)
    expect(claude.sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
  })

  it('defaults heavy/standard/routine to Opus 5.5 and cheap to Sonnet 5.5', () => {
    expect(DEFAULT_ROLE_MODEL.heavy).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
    expect(DEFAULT_ROLE_MODEL.standard).toMatchObject({ model: 'claude-opus-5-5', effort: 'medium' })
    expect(DEFAULT_ROLE_MODEL.cheap).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' })
    expect(DEFAULT_ROLE_MODEL.routine.model).toBe('claude-opus-5-5')
  })
})

describe('helpers', () => {
  it('remaps retired ids and passes everything else through', () => {
    expect(remapLegacyModel('claude-opus-4-7')).toBe('claude-opus-5-5')
    expect(remapLegacyModel('claude-sonnet-4-6')).toBe('claude-sonnet-5-5')
    expect(remapLegacyModel('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5')
    expect(remapLegacyModel('claude-opus-5-5')).toBe('claude-opus-5-5')
    expect(remapLegacyModel('toString')).toBe('toString')
  })

  it('picks the preferred effort when accepted, else the model default, else none', () => {
    expect(effortFor('claude-opus-5-5', 'high')).toBe('high')
    expect(effortFor('gpt-6-astra', 'none')).toBe('high')
    expect(effortFor('claude-haiku-4-5', 'high')).toBeNull()
    expect(effortFor('unknown-model', 'high')).toBeNull()
    expect(effortFor('claude-opus-4-8', 'high')).toBe('high')
  })

  it('lists engine models by the CLI id (Copilot uses dots)', () => {
    expect(engineModels('copilot').map((m) => m.id)).toContain('claude-opus-5.5')
    expect(engineModels('claude').map((m) => m.id)).toContain('claude-opus-5-5')
    expect(engineModels('codex').map((m) => m.id)).toContain('gpt-6-sol')
  })
})
