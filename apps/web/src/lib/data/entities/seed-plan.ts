import {
  displayRepoName, isUsableAlias, lastRepoSegment, normAlias, repoKey, repoSlugAliases, repoSlugForm, repoStemAlias,
} from './normalize'

export type EntityKind = 'person' | 'project' | 'repo' | 'app' | 'tool' | 'dominion' | 'concept'
export type EntityRefKind = 'dominion' | 'project' | 'hangar_repo' | 'dominion_repo' | 'label' | 'member' | 'virtual_member'

export interface SeedSources {
  dominions: Array<{ id: string; name: string }>
  projects: Array<{ id: string; name: string }>
  labels: Array<{ id: string; name: string }>
  dominionRepos: Array<{ repoSlug: string }>
  hangarRepos: Array<{ id: string; slug: string; name: string; ghSlug: string | null }>
  members: Array<{ id: string; name: string | null }>
  memberProfiles: Array<{ userId: string; displayName: string | null }>
  virtualMembers: Array<{ id: string; name: string }>
}

export interface SeedEntity {
  kind: EntityKind
  name: string
  normName: string
  refKind: EntityRefKind
  refId: string
  aliases: string[]
}

const MIN_FIRST_NAME = 4
const MAX_NAME = 200
const REF_PRIORITY: Record<EntityRefKind, number> = {
  hangar_repo: 3, dominion_repo: 2, dominion: 2, project: 2, member: 2, virtual_member: 2, label: 1,
}

class SeedPlan {
  private readonly byKey = new Map<string, SeedEntity>()

  add(kind: EntityKind, rawNorm: string, rawName: string, refKind: EntityRefKind, refId: string): SeedEntity | null {
    const normName = rawNorm.slice(0, MAX_NAME)
    const name = rawName.trim().slice(0, MAX_NAME)
    if (!normName || !name) return null
    const key = `${kind}:${normName}`
    const existing = this.byKey.get(key)
    if (existing) {
      if (REF_PRIORITY[refKind] > REF_PRIORITY[existing.refKind]) Object.assign(existing, { name, refKind, refId })
      return existing
    }
    const created: SeedEntity = { kind, name, normName, refKind, refId, aliases: [] }
    this.byKey.set(key, created)
    return created
  }

  entities(): SeedEntity[] {
    return [...this.byKey.values()]
      .map((e) => ({ ...e, aliases: uniqueAliases(e.aliases) }))
      .filter((e) => e.aliases.length > 0)
  }
}

function uniqueAliases(aliases: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of aliases) {
    const alias = raw.trim().replace(/\s+/g, ' ')
    const norm = normAlias(alias)
    if (!isUsableAlias(norm) || seen.has(norm) || alias.length > MAX_NAME) continue
    seen.add(norm)
    out.push(alias)
  }
  return out
}

const labelSuffix = (name: string, prefix: string) =>
  name.toLowerCase().startsWith(prefix) ? name.slice(prefix.length).trim() : null

function addRepos(plan: SeedPlan, s: SeedSources): void {
  const repo = (raw: string, refKind: EntityRefKind, refId: string, name?: string) => {
    const key = repoKey(raw)
    if (!key) return null
    const bare = repoStemAlias(raw) !== null || key === repoSlugForm(raw)
    const e = plan.add('repo', key, name ?? (bare ? displayRepoName(key) : repoSlugForm(raw)), refKind, refId)
    e?.aliases.push(...repoSlugAliases(raw))
    return e
  }
  for (const r of s.hangarRepos) {
    const e = repo(r.slug, 'hangar_repo', r.id, r.name)
    if (!e) continue
    e.aliases.push(r.name)
    const gh = r.ghSlug?.trim()
    const ghRepo = lastRepoSegment(gh)
    if (gh) e.aliases.push(gh)
    if (ghRepo) e.aliases.push(...repoSlugAliases(ghRepo))
  }
  for (const r of s.dominionRepos) repo(r.repoSlug, 'dominion_repo', r.repoSlug)
  for (const l of s.labels) {
    const slug = labelSuffix(l.name, 'repo:')
    if (slug) repo(slug, 'label', l.id)
  }
}

function addDominions(plan: SeedPlan, s: SeedSources): void {
  for (const d of s.dominions) plan.add('dominion', normAlias(d.name), d.name, 'dominion', d.id)?.aliases.push(d.name)
  for (const l of s.labels) {
    const name = labelSuffix(l.name, 'dom:')
    if (name) plan.add('dominion', normAlias(name), name, 'label', l.id)?.aliases.push(name)
  }
}

function addPeople(plan: SeedPlan, s: SeedSources): void {
  const people = new Map<string, SeedEntity>()
  const named = s.members.filter((m) => m.name?.trim())
  for (const m of named) {
    const e = plan.add('person', normAlias(m.name!), m.name!, 'member', m.id)
    if (e) people.set(m.id, e)
  }
  for (const p of s.memberProfiles) {
    const display = p.displayName?.trim()
    if (!display) continue
    const e = people.get(p.userId) ?? plan.add('person', normAlias(display), display, 'member', p.userId)
    if (e) people.set(p.userId, e)
    e?.aliases.push(display)
  }
  for (const v of s.virtualMembers) plan.add('person', normAlias(v.name), v.name, 'virtual_member', v.id)?.aliases.push(v.name)
  for (const e of people.values()) e.aliases.push(e.name)

  const firstNames = new Map<string, SeedEntity[]>()
  for (const e of new Set(people.values())) {
    const first = e.name.trim().split(/\s+/)[0]
    if (!first || first === e.name.trim() || first.length < MIN_FIRST_NAME) continue
    const norm = normAlias(first)
    firstNames.set(norm, [...(firstNames.get(norm) ?? []), e])
  }
  for (const [, owners] of firstNames) {
    if (owners.length === 1) owners[0].aliases.push(owners[0].name.trim().split(/\s+/)[0])
  }
}

// Seed rows for one owner: Dominions (+ dom:* labels), live boards, repos
// grouped by repo key, and people. Pure, so the rules are testable.
export function buildSeedPlan(s: SeedSources): SeedEntity[] {
  const plan = new SeedPlan()
  addDominions(plan, s)
  for (const p of s.projects) plan.add('project', normAlias(p.name), p.name, 'project', p.id)?.aliases.push(p.name)
  addRepos(plan, s)
  addPeople(plan, s)
  return plan.entities()
}
