import { afterEach, describe, expect, it, vi } from 'vitest'
import { canUseVorath, withoutVorathProjectFields, withoutVorathTaskFields } from '../vorath-access'

describe('vorath-access', () => {
  afterEach(() => vi.unstubAllEnvs())

  const prodOwner = () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VORATH_USER_IDS', 'owner')
  }

  it('allows only allowlisted ids in production and fails closed when unset', () => {
    prodOwner()
    expect(canUseVorath('owner')).toBe(true)
    expect(canUseVorath('tester')).toBe(false)
    expect(canUseVorath(null)).toBe(false)
    vi.stubEnv('VORATH_USER_IDS', '')
    vi.stubEnv('KAIROS_OPERATOR_USER_ID', '')
    expect(canUseVorath('owner')).toBe(false)
  })

  it('falls back to KAIROS_OPERATOR_USER_ID', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VORATH_USER_IDS', '')
    vi.stubEnv('KAIROS_OPERATOR_USER_ID', 'op')
    expect(canUseVorath('op')).toBe(true)
  })

  it('strips card mission metadata for non-owners only', () => {
    prodOwner()
    const data = { name: 'x', metadata: { hangar: { instruction: 'evil', autoRun: true }, other: 1 } }
    expect(withoutVorathTaskFields('tester', data).metadata).toEqual({ other: 1 })
    expect(withoutVorathTaskFields('owner', data)).toBe(data)
    const plain: { name: string; metadata?: Record<string, unknown> } = { name: 'y' }
    expect(withoutVorathTaskFields('tester', plain)).toEqual({ name: 'y' })
  })

  it('strips board mission settings and the Dominion link for non-owners only', () => {
    prodOwner()
    const data = { name: 'b', dominionId: 'd1', settings: { hangar: { autoLaunch: true }, boardTheme: 'x' } }
    expect(withoutVorathProjectFields('tester', data)).toEqual({ name: 'b', settings: { boardTheme: 'x' } })
    expect(withoutVorathProjectFields('owner', data)).toBe(data)
  })
})
