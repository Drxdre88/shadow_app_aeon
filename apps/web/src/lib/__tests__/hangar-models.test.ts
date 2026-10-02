import { describe, expect, it } from 'vitest'
import { DEFAULT_ROLE_MODEL, MODEL_REGISTRY_REVIEWED_AT } from '@aeon/shared/ai/models'
import { HANGAR_MODELS_CHECKED_AT, getHangarDefault, getHangarModels } from '../hangar-models'

describe('Hangar model catalog (from the model registry)', () => {
  it('stamps the catalog with the registry review date', () => {
    expect(HANGAR_MODELS_CHECKED_AT).toBe(MODEL_REGISTRY_REVIEWED_AT)
  })

  it('lists each engine by its own CLI id and offers no older Opus or Sonnet', () => {
    const copilot = getHangarModels('copilot').map((m) => m.id)
    expect(copilot).toContain('claude-opus-5.5')
    expect(copilot).toContain('gpt-6.1-sol')
    expect(getHangarModels('claude').map((m) => m.id)).toContain('claude-opus-5-5')
    expect(getHangarModels('codex').map((m) => m.id)).toContain('gpt-6-sol')
    expect(getHangarModels('codex').map((m) => m.id)).not.toContain('gpt-6.1-sol')
    const retired = ['claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-4-6', 'claude-sonnet-4.6', 'claude-opus-4.7']
    for (const engine of ['copilot', 'claude', 'codex']) {
      for (const { id } of getHangarModels(engine)) {
        expect(retired).not.toContain(id)
        expect(id).not.toMatch(/^gpt-5/)
      }
    }
  })

  it('every engine default is one of that engine\'s listed models', () => {
    for (const engine of ['copilot', 'claude', 'codex']) {
      const d = getHangarDefault(engine)
      expect(d).toEqual(DEFAULT_ROLE_MODEL.mission[engine as 'copilot'])
      expect(getHangarModels(engine).map((m) => m.id)).toContain(d?.model)
    }
  })

  it('refuses unknown engines and inherited members', () => {
    expect(getHangarModels('gemini')).toEqual([])
    expect(getHangarModels('toString')).toEqual([])
    expect(getHangarDefault('constructor')).toBeNull()
  })
})
