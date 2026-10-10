import { describe, it, expect } from 'vitest'
import {
  aliasRule, lastRepoSegment, normAlias, passesRule, repoKey, repoSlugAliases,
} from '../normalize'
import { EntityMatcher, SCAN_TEXT_CAP } from '../matcher'

describe('normAlias', () => {
  it('lowercases, collapses whitespace, strips edge punctuation, keeps inner - _ /', () => {
    expect(normAlias('  "Shadow   Apps!" ')).toBe('shadow apps')
    expect(normAlias('kal-el')).toBe('kal-el')
    expect(normAlias('Drxdre88/shadow_app_aeon.')).toBe('drxdre88/shadow_app_aeon')
  })
})

describe('repo keys', () => {
  it.each([
    ['shadow_app_aeon', 'aeon'],
    ['shadow-data', 'shadow_data'],
    ['shadow_research_lab', 'research_lab'],
    ['stp_app_ermac', 'ermac'],
    ['stp_app_dmc', 'dmc'],
    ['dmc', 'dmc'],
    ['rnd_ai_quant', 'rnd_ai_quant'],
  ])('%s groups under %s', (slug, key) => {
    expect(repoKey(slug)).toBe(key)
  })

  it('adds the stripped form as an alias only when 4+ chars', () => {
    expect(repoSlugAliases('shadow_app_aeon')).toEqual(['shadow_app_aeon', 'shadow-app-aeon', 'aeon'])
    expect(repoSlugAliases('stp_app_dmc')).toEqual(['stp_app_dmc', 'stp-app-dmc'])
    expect(repoSlugAliases('shadow-data')).toEqual(['shadow_data', 'shadow-data'])
  })

  it('takes the last segment of a path-like repo value', () => {
    expect(lastRepoSegment('sefe/Short Term Power/stp_app_ermac')).toBe('stp_app_ermac')
    expect(lastRepoSegment('C:\\dev\\shadow_app_swarm')).toBe('shadow_app_swarm')
    expect(lastRepoSegment(42)).toBeNull()
  })
})

describe('alias rules', () => {
  it('initials are exact, stoplist words and first names need a capital', () => {
    expect(aliasRule('MG', 'person')).toBe('exact')
    expect(aliasRule('Rift', 'repo')).toBe('capitalised')
    expect(aliasRule('Heidi', 'person')).toBe('capitalised')
    expect(aliasRule('Heidi Gilje', 'person')).toBe('any')
    expect(aliasRule('wraith', 'repo')).toBe('any')
    expect(passesRule('capitalised', 'rift', 'Rift')).toBe(true)
    expect(passesRule('capitalised', 'rift', 'rift')).toBe(false)
    expect(passesRule('exact', 'MG', 'mg')).toBe(false)
  })
})

describe('EntityMatcher', () => {
  const m = new EntityMatcher([
    { entityId: 'aeon', alias: 'aeon', kind: 'repo' },
    { entityId: 'aeon', alias: 'shadow_app_aeon', kind: 'repo' },
    { entityId: 'rift', alias: 'rift', kind: 'repo' },
    { entityId: 'mg', alias: 'MG', kind: 'person' },
    { entityId: 'shadow-apps', alias: 'Shadow Apps', kind: 'dominion' },
    { entityId: 'generic', alias: 'data', kind: 'repo' },
  ])

  it('matches whole words only, longest alias first', () => {
    expect([...m.match('merged into shadow_app_aeon today')]).toEqual(['aeon'])
    expect(m.match('aeonian times').size).toBe(0)
  })

  it('applies the stoplist and the exact-initials rule', () => {
    expect(m.match('a rift between teams').has('rift')).toBe(false)
    expect(m.match('Rift deploy').has('rift')).toBe(true)
    expect(m.match('5 mg dose').has('mg')).toBe(false)
    expect(m.match('MG approved').has('mg')).toBe(true)
  })

  it('matches multi-word aliases across any whitespace and never generic ones', () => {
    expect(m.match('the shadow\n  apps dominion').has('shadow-apps')).toBe(true)
    expect(m.match('raw data dump').has('generic')).toBe(false)
  })

  it('scans at most the text cap', () => {
    expect(m.match(`${'x '.repeat(SCAN_TEXT_CAP)} aeon`).size).toBe(0)
  })
})
