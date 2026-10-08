import { BUCKETS, globToRegExp } from './classify.mjs'

export const IDENTITY_CLASSES = ['owner_agent', 'owner_human', 'others', 'bots']
export const OWNER_CLASSES = new Set(['owner_human', 'owner_agent'])
const TOP_DIRS = 10
const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

export class IdentityMatcher {
  constructor(identities = {}) {
    this.rules = []
    for (const cls of IDENTITY_CLASSES) {
      for (const entry of identities[cls] || []) this.rules.push({ cls, ...compileEntry(entry) })
    }
  }

  classify(name = '', email = '') {
    for (const rule of this.rules) {
      if (rule.re.test(name) || rule.re.test(email) || rule.re.test(`${name} <${email}>`)) return rule.cls
    }
    return 'unknown'
  }
}

function compileEntry(entry) {
  const text = String(entry).trim()
  const regex = /^\/(.+)\/([a-z]*)$/.exec(text)
  if (regex) return { re: new RegExp(regex[1], regex[2].includes('i') ? regex[2] : `${regex[2]}i`) }
  return { re: globToRegExp(text) }
}

export function localDay(isoDate) {
  return String(isoDate || '').slice(0, 10)
}

export const AI_REASONS = ['agent_identity', 'trailer', 'agent_era']

export function attributeAi(commit, agentEraStart = null) {
  let reason = null
  if (commit.identityClass === 'owner_agent') reason = 'agent_identity'
  else if (commit.aiAssisted) reason = 'trailer'
  else if (agentEraStart && commit.identityClass === 'owner_human' && localDay(commit.authorDate) >= agentEraStart) reason = 'agent_era'
  commit.aiAttributed = reason !== null
  commit.aiReason = reason
  return commit
}

export function isoWeek(day) {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const dow = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dow)
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function isUnique(commit, { crossRepo = false } = {}) {
  const counted = 'counted' in commit ? commit.counted : !commit.isMerge && !commit.dupOf
  if (!counted) return false
  return !crossRepo || (!commit.crossRepoDupOf && !commit.crossRepoPatchDupOf)
}

export class Metrics {
  constructor({ trackDirs = false, crossRepo = false } = {}) {
    this.crossRepo = crossRepo
    this.trackDirs = trackDirs
    this.commits = 0
    this.uniqueCommits = 0
    this.merges = 0
    this.duplicates = 0
    this.droppedSquashes = 0
    this.countedSquashes = 0
    this.noiseCommits = 0
    this.aiAssistedCommits = 0
    this.aiAttributedCommits = 0
    this.aiAttributedAdded = 0
    this.aiAttributedRemoved = 0
    this.aiAttributedCodeAdded = 0
    this.aiAttributedCodeRemoved = 0
    this.aiAttributedByReason = Object.fromEntries(AI_REASONS.map((r) => [r, 0]))
    this.linesAddedExclGiantNoise = 0
    this.linesRemovedExclGiantNoise = 0
    this.crossRepoDuplicates = 0
    this.giantCommits = 0
    this.rawLinesAdded = 0
    this.rawLinesRemoved = 0
    this.countedRawAdded = 0
    this.countedRawRemoved = 0
    this.excludedPathAdded = 0
    this.excludedPathRemoved = 0
    this.bucketsExclGiantNoise = Object.fromEntries(BUCKETS.map((b) => [b, { added: 0, removed: 0 }]))
    this.linesAdded = 0
    this.linesRemoved = 0
    this.linesAddedExclGiant = 0
    this.linesRemovedExclGiant = 0
    this.buckets = Object.fromEntries(BUCKETS.map((b) => [b, { added: 0, removed: 0 }]))
    this.filesAdded = 0
    this.filesModified = 0
    this.filesDeleted = 0
    this.filesRenamed = 0
    this.binaryFiles = 0
    this.days = new Set()
    this.firstCommit = null
    this.lastCommit = null
    this.dirs = new Map()
  }

  add(c) {
    this.commits++
    this.rawLinesAdded += c.rawLinesAdded ?? c.linesAdded
    this.rawLinesRemoved += c.rawLinesRemoved ?? c.linesRemoved
    if (!this.firstCommit || c.authorDate < this.firstCommit) this.firstCommit = c.authorDate
    if (!this.lastCommit || c.authorDate > this.lastCommit) this.lastCommit = c.authorDate
    if (c.isMerge) this.merges++
    else if (c.dropReason === 'patch-dup') this.duplicates++
    else if (c.dropReason === 'squash-dup' || c.dropReason === 'squash-branch-present') this.droppedSquashes++
    if (this.crossRepo && isUnique(c) && (c.crossRepoDupOf || c.crossRepoPatchDupOf)) this.crossRepoDuplicates++
    if (!isUnique(c, { crossRepo: this.crossRepo })) return
    this.uniqueCommits++
    if (c.squashOf != null) this.countedSquashes++
    if (c.aiAssisted) this.aiAssistedCommits++
    if (c.aiAttributed) {
      this.aiAttributedCommits++
      this.aiAttributedAdded += c.linesAdded
      this.aiAttributedRemoved += c.linesRemoved
      this.aiAttributedCodeAdded += c.buckets.code.added
      this.aiAttributedCodeRemoved += c.buckets.code.removed
      if (c.aiReason in this.aiAttributedByReason) this.aiAttributedByReason[c.aiReason]++
    }
    if (c.noise) this.noiseCommits++
    this.countedRawAdded += c.rawLinesAdded ?? c.linesAdded
    this.countedRawRemoved += c.rawLinesRemoved ?? c.linesRemoved
    this.excludedPathAdded += c.excludedAdded || 0
    this.excludedPathRemoved += c.excludedRemoved || 0
    if (!c.giant && !c.noise) {
      this.linesAddedExclGiantNoise += c.linesAdded
      this.linesRemovedExclGiantNoise += c.linesRemoved
      for (const b of BUCKETS) {
        this.bucketsExclGiantNoise[b].added += c.buckets[b].added
        this.bucketsExclGiantNoise[b].removed += c.buckets[b].removed
      }
    }
    this.days.add(localDay(c.authorDate))
    this.linesAdded += c.linesAdded
    this.linesRemoved += c.linesRemoved
    if (c.giant) this.giantCommits++
    else {
      this.linesAddedExclGiant += c.linesAdded
      this.linesRemovedExclGiant += c.linesRemoved
    }
    for (const b of BUCKETS) {
      this.buckets[b].added += c.buckets[b].added
      this.buckets[b].removed += c.buckets[b].removed
    }
    this.filesAdded += c.filesAdded
    this.filesModified += c.filesModified
    this.filesDeleted += c.filesDeleted
    this.filesRenamed += c.filesRenamed
    this.binaryFiles += c.binaryFiles
    if (this.trackDirs) {
      for (const [dir, lines] of Object.entries(c.codeDirs || {})) this.dirs.set(dir, (this.dirs.get(dir) || 0) + lines)
    }
  }

  toJSON() {
    const out = {
      commits: this.commits,
      uniqueCommits: this.uniqueCommits,
      merges: this.merges,
      duplicates: this.duplicates,
      droppedSquashes: this.droppedSquashes,
      countedSquashes: this.countedSquashes,
      aiAssistedCommits: this.aiAssistedCommits,
      noiseCommits: this.noiseCommits,
      lines_counted: { added: this.countedRawAdded, removed: this.countedRawRemoved },
      authoredAdded: this.linesAdded,
      authoredRemoved: this.linesRemoved,
      excludedPathLines: { added: this.excludedPathAdded, removed: this.excludedPathRemoved },
      lines_raw: { added: this.rawLinesAdded, removed: this.rawLinesRemoved },
      lines_counted_excl_giant_noise: { added: this.linesAddedExclGiantNoise, removed: this.linesRemovedExclGiantNoise },
      ...(this.crossRepo ? { crossRepoDuplicates: this.crossRepoDuplicates } : {}),
      giantCommits: this.giantCommits,
      linesAdded: this.linesAdded,
      linesRemoved: this.linesRemoved,
      linesAddedExclGiant: this.linesAddedExclGiant,
      linesRemovedExclGiant: this.linesRemovedExclGiant,
      rawLinesAdded: this.rawLinesAdded,
      rawLinesRemoved: this.rawLinesRemoved,
      buckets: this.buckets,
      authoredAddedAll: this.linesAdded,
      authoredRemovedAll: this.linesRemoved,
      codeAddedAll: this.buckets.code.added,
      codeRemovedAll: this.buckets.code.removed,
      testsAddedAll: this.buckets.tests.added,
      testsRemovedAll: this.buckets.tests.removed,
      docsAddedAll: this.buckets.docs.added,
      docsRemovedAll: this.buckets.docs.removed,
      configAddedAll: this.buckets.config.added,
      configRemovedAll: this.buckets.config.removed,
      generatedAddedAll: this.buckets.generated_or_data.added,
      generatedRemovedAll: this.buckets.generated_or_data.removed,
      otherAddedAll: this.buckets.other.added,
      otherRemovedAll: this.buckets.other.removed,
      aiAttributedCommits: this.aiAttributedCommits,
      aiAttributedAdded: this.aiAttributedAdded,
      aiAttributedRemoved: this.aiAttributedRemoved,
      aiAttributedCodeAdded: this.aiAttributedCodeAdded,
      aiAttributedCodeRemoved: this.aiAttributedCodeRemoved,
      aiAttributedByReason: this.aiAttributedByReason,
      bucketsExclGiantNoise: this.bucketsExclGiantNoise,
      codeExclGiantNoise: this.bucketsExclGiantNoise.code,
      filesAdded: this.filesAdded,
      filesModified: this.filesModified,
      filesDeleted: this.filesDeleted,
      filesRenamed: this.filesRenamed,
      binaryFiles: this.binaryFiles,
      activeDays: this.days.size,
      firstCommit: this.firstCommit,
      lastCommit: this.lastCommit,
    }
    if (this.trackDirs) {
      out.topCodeDirs = [...this.dirs.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, TOP_DIRS)
        .map(([dir, linesChanged]) => ({ dir, linesChanged }))
    }
    return out
  }
}

class Grouped {
  constructor(options) {
    this.options = options
    this.all = new Metrics(options)
    this.owner = new Metrics(options)
    this.byIdentity = new Map()
  }

  add(commit) {
    this.all.add(commit)
    const cls = commit.identityClass || 'unknown'
    if (OWNER_CLASSES.has(cls)) this.owner.add(commit)
    if (!this.byIdentity.has(cls)) this.byIdentity.set(cls, new Metrics(this.options))
    this.byIdentity.get(cls).add(commit)
  }

  toJSON() {
    return { all: this.all.toJSON(), owner: this.owner.toJSON(), byIdentity: Object.fromEntries([...this.byIdentity].sort(byKey).map(([k, m]) => [k, m.toJSON()])) }
  }
}

export function buildSummary(commits, { crossRepo = false, meta = {} } = {}) {
  const total = new Grouped({ trackDirs: true, crossRepo })
  const months = new Map()
  const weeks = new Map()
  const unknown = new Map()
  for (const c of commits) {
    total.add(c)
    const day = localDay(c.authorDate)
    const month = day.slice(0, 7)
    const week = isoWeek(day)
    if (!months.has(month)) months.set(month, new Grouped({ crossRepo }))
    if (!weeks.has(week)) weeks.set(week, new Grouped({ crossRepo }))
    months.get(month).add(c)
    weeks.get(week).add(c)
    if (c.identityClass === 'unknown') {
      const key = `${c.authorName} <${c.authorEmail}>`
      unknown.set(key, (unknown.get(key) || 0) + 1)
    }
  }
  const totalJson = total.toJSON()
  return {
    ...meta,
    totals: totalJson.all,
    ownerTotals: totalJson.owner,
    byIdentity: totalJson.byIdentity,
    unknownIdentities: [...unknown.entries()].sort((a, b) => b[1] - a[1]).map(([identity, commitCount]) => ({ identity, commits: commitCount })),
    byMonth: Object.fromEntries([...months].sort(byKey).map(([k, g]) => [k, g.toJSON()])),
    byWeek: Object.fromEntries([...weeks].sort(byKey).map(([k, g]) => [k, g.toJSON()])),
  }
}
