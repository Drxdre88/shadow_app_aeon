import { describe, expect, it } from 'vitest'
import { applyMindEnvAliases, type MindEnv } from './mind-env-alias'

describe('applyMindEnvAliases', () => {
  it('copies VORATH_* onto the matching KAIROS_* key', () => {
    const env: MindEnv = { VORATH_OPERATOR_USER_ID: 'u1' }
    expect(applyMindEnvAliases(env)).toEqual(['KAIROS_OPERATOR_USER_ID'])
    expect(env.KAIROS_OPERATOR_USER_ID).toBe('u1')
    expect(env.VORATH_OPERATOR_USER_ID).toBe('u1')
  })

  it('lets the VORATH value win over an existing KAIROS value', () => {
    const env: MindEnv = { KAIROS_AGENDA: '0', VORATH_AGENDA: '1' }
    applyMindEnvAliases(env)
    expect(env.KAIROS_AGENDA).toBe('1')
  })

  it('leaves KAIROS-only keys and unrelated keys untouched', () => {
    const env: MindEnv = { KAIROS_WORKER_URL: 'http://w', OPENAI_API_KEY: 'k', MY_VORATH_X: 'y' }
    expect(applyMindEnvAliases(env)).toEqual([])
    expect(env).toEqual({ KAIROS_WORKER_URL: 'http://w', OPENAI_API_KEY: 'k', MY_VORATH_X: 'y' })
  })

  it('ignores empty or unset VORATH values so they cannot blank a KAIROS value', () => {
    const env: MindEnv = { KAIROS_PREDICTIONS: '1', VORATH_PREDICTIONS: '', VORATH_TRUST: undefined, VORATH_: 'x' }
    expect(applyMindEnvAliases(env)).toEqual([])
    expect(env.KAIROS_PREDICTIONS).toBe('1')
    expect('KAIROS_TRUST' in env).toBe(false)
    expect('KAIROS_' in env).toBe(false)
  })

  it('keeps the suffix case exactly', () => {
    const env: MindEnv = { VORATH_Chat_Routine: 'on' }
    applyMindEnvAliases(env)
    expect(env.KAIROS_Chat_Routine).toBe('on')
  })
})
