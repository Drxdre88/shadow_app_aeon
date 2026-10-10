import { describe, it, expect } from 'vitest'
import { buildSeedPlan, type SeedSources } from '../seed-plan'

function sources(over: Partial<SeedSources> = {}): SeedSources {
  return {
    dominions: [], projects: [], labels: [], dominionRepos: [], hangarRepos: [],
    members: [], memberProfiles: [], virtualMembers: [], ...over,
  }
}

const find = (plan: ReturnType<typeof buildSeedPlan>, kind: string, norm: string) =>
  plan.find((e) => e.kind === kind && e.normName === norm)

describe('buildSeedPlan', () => {
  it('groups a repo across dominion_repos, hangar and repo:* labels', () => {
    const plan = buildSeedPlan(sources({
      dominionRepos: [{ repoSlug: 'shadow_app_aeon' }, { repoSlug: 'shadow_app_arq' }],
      hangarRepos: [
        { id: 'h1', slug: 'aeon', name: 'Aeon', ghSlug: 'Drxdre88/shadow_app_aeon' },
        { id: 'h2', slug: 'arq', name: 'ARQ', ghSlug: null },
      ],
      labels: [{ id: 'l1', name: 'repo:aeon' }, { id: 'l2', name: 'repo:arq' }],
    }))
    const repos = plan.filter((e) => e.kind === 'repo')
    expect(repos.map((r) => r.normName).sort()).toEqual(['aeon', 'arq'])
    const aeon = find(plan, 'repo', 'aeon')!
    expect(aeon).toMatchObject({ name: 'Aeon', refKind: 'hangar_repo', refId: 'h1' })
    expect(aeon.aliases).toEqual(expect.arrayContaining(['aeon', 'shadow_app_aeon', 'shadow-app-aeon', 'Drxdre88/shadow_app_aeon']))
    expect(find(plan, 'repo', 'arq')!.aliases).toEqual(expect.arrayContaining(['arq', 'shadow_app_arq']))
  })

  it('dom:* labels alias an existing Dominion or seed a label-backed one', () => {
    const plan = buildSeedPlan(sources({
      dominions: [{ id: 'd1', name: 'Shadow Apps' }],
      labels: [{ id: 'l1', name: 'dom:Shadow Apps' }, { id: 'l2', name: 'dom:KAIROS' }],
    }))
    expect(find(plan, 'dominion', 'shadow apps')).toMatchObject({ refKind: 'dominion', refId: 'd1' })
    expect(find(plan, 'dominion', 'kairos')).toMatchObject({ name: 'KAIROS', refKind: 'label', refId: 'l2' })
  })

  it('skips blank names, keeps a unique 4+ char first name, drops shared first names', () => {
    const plan = buildSeedPlan(sources({
      members: [
        { id: 'u1', name: 'Heidi Gilje' }, { id: 'u2', name: null }, { id: 'u3', name: '  ' },
        { id: 'u4', name: 'David One' }, { id: 'u5', name: 'David Two' }, { id: 'u6', name: 'Ali Farah' },
      ],
      memberProfiles: [{ userId: 'u1', displayName: 'Heidi G' }],
      virtualMembers: [{ id: 'v1', name: 'MG' }],
    }))
    const people = plan.filter((e) => e.kind === 'person')
    expect(people.map((p) => p.name).sort()).toEqual(['Ali Farah', 'David One', 'David Two', 'Heidi Gilje', 'MG'])
    expect(find(plan, 'person', 'heidi gilje')!.aliases).toEqual(expect.arrayContaining(['Heidi', 'Heidi G', 'Heidi Gilje']))
    expect(find(plan, 'person', 'david one')!.aliases).toEqual(['David One'])
    expect(find(plan, 'person', 'ali farah')!.aliases).toEqual(['Ali Farah'])
    expect(find(plan, 'person', 'mg')).toMatchObject({ refKind: 'virtual_member', aliases: ['MG'] })
  })

  it('never stores a generic alias', () => {
    const plan = buildSeedPlan(sources({ labels: [{ id: 'l1', name: 'repo:shadow-data' }], projects: [{ id: 'p1', name: 'Data' }] }))
    expect(find(plan, 'project', 'data')).toBeUndefined()
    expect(find(plan, 'repo', 'shadow_data')!.aliases).toEqual(['shadow_data', 'shadow-data'])
  })
})
