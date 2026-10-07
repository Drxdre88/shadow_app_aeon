import { localDay } from './summary.mjs'

export const OWNER_PR_LOGINS = ['andrey.selikhov@sefe.eu', 'drxdre88']
export const AGENT_PR_LOGINS = ['copilot']
const HOUR_MS = 3600000

export function prLogin(pr) {
  return String(pr.author?.login || pr.author?.displayName || '').toLowerCase()
}

export function prRole(pr) {
  const login = prLogin(pr)
  if (OWNER_PR_LOGINS.includes(login)) return 'owner_human'
  if (AGENT_PR_LOGINS.includes(login)) return 'owner_agent'
  return 'others'
}

export const isOwnerPr = (pr) => prRole(pr) !== 'others'
export const isMerged = (pr) => pr.status === 'completed'
export const mergedAt = (pr) => pr.mergedAt || pr.closedAt || null

export function median(values) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function inWindow(day, since, end) {
  return Boolean(day) && day >= since && day <= end
}

export function aggregatePrs(prs, { since, end }) {
  const windowed = prs.filter((pr) => inWindow(localDay(pr.createdAt), since, end))
  const owner = windowed.filter(isOwnerPr)
  const totals = { opened: owner.length, merged: 0, abandoned: 0, active: 0, agent: 0, all: windowed.length }
  const byMonth = new Map()
  const byRepo = new Map()
  const mergeHours = []
  const bump = (map, key, field) => {
    if (!map.has(key)) map.set(key, { opened: 0, merged: 0 })
    map.get(key)[field]++
  }
  for (const pr of owner) {
    if (prRole(pr) === 'owner_agent') totals.agent++
    bump(byMonth, localDay(pr.createdAt).slice(0, 7), 'opened')
    bump(byRepo, pr.repo, 'opened')
    if (pr.status === 'abandoned') totals.abandoned++
    else if (pr.status === 'active') totals.active++
    if (!isMerged(pr)) continue
    totals.merged++
    bump(byRepo, pr.repo, 'merged')
    const closed = mergedAt(pr)
    if (closed && inWindow(localDay(closed), since, end)) bump(byMonth, localDay(closed).slice(0, 7), 'merged')
    const h = closed ? (Date.parse(closed) - Date.parse(pr.createdAt)) / HOUR_MS : NaN
    if (Number.isFinite(h) && h >= 0) mergeHours.push(h)
  }
  const withinHour = mergeHours.filter((h) => h <= 1).length
  const multiCommit = owner.filter((pr) => (pr.commitCount || 0) > 1).length
  return {
    owner,
    totals,
    byMonth,
    byRepo,
    medianMergeHours: median(mergeHours),
    mergedWithinHour: withinHour,
    mergeSamples: mergeHours.length,
    singleCommit: owner.filter((pr) => pr.commitCount === 1).length,
    multiCommit,
    others: windowed.filter((pr) => !isOwnerPr(pr)),
  }
}

export function otherContributors(commits, otherPrs, { isCounted }) {
  const people = new Map()
  const key = (email, fallback) => String(email || fallback || 'unknown').toLowerCase()
  const entry = (k, name) => {
    if (!people.has(k)) people.set(k, { name, commits: 0, prs: 0 })
    return people.get(k)
  }
  const notOwner = commits.filter((c) => c.identityClass && !c.identityClass.startsWith('owner_'))
  for (const c of notOwner) {
    if (!isCounted(c)) continue
    entry(key(c.authorEmail, c.authorName), c.authorName).commits++
  }
  for (const pr of otherPrs) entry(key(pr.author?.login, pr.author?.displayName), pr.author?.displayName || pr.author?.login).prs++
  const list = [...people.values()].sort((a, b) => b.commits + b.prs - (a.commits + a.prs) || (a.name < b.name ? -1 : 1))
  const byClass = {}
  for (const c of notOwner) if (isCounted(c)) byClass[c.identityClass] = (byClass[c.identityClass] || 0) + 1
  return { people: list, commits: list.reduce((t, p) => t + p.commits, 0), prs: otherPrs.length, byClass }
}
