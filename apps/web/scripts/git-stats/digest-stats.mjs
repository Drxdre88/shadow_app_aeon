import { localDayOf } from './digest-days.mjs'

export const OWNER_CLASSES = new Set(['owner_human', 'owner_agent'])
export const MAX_COMMITS = 15
export const SUMMARY_MAX = 240
const TOP_DIRS = 5

const sha7 = (sha) => String(sha || '').slice(0, 7)
const fmt = (n) => Number(n || 0).toLocaleString('en-GB')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Owner commits that count for `day` under the extractor's dedupe and squash rules. */
export function ownerCommitsOn(commits, day, timeZone = null) {
  return commits.filter((c) => c.counted && OWNER_CLASSES.has(c.identityClass) && localDayOf(c.authorDate, timeZone) === day)
}

/** PR counts for `day` from normalised PR records; null when PR data is unavailable. */
export function prCountsOn(records, day, timeZone = null) {
  if (!Array.isArray(records)) return { prsOpened: null, prsMerged: null }
  let prsOpened = 0
  let prsMerged = 0
  for (const pr of records) {
    if (pr.createdAt && localDayOf(pr.createdAt, timeZone) === day) prsOpened++
    const mergedAt = pr.mergedAt || (pr.status === 'completed' ? pr.closedAt : null)
    if (pr.status === 'completed' && mergedAt && localDayOf(mergedAt, timeZone) === day) prsMerged++
  }
  return { prsOpened, prsMerged }
}

/** Per repo-day aggregate stored locally and used to build the Aeon payload. */
export function buildRepoDay(slug, day, commits, { prs = null, prNote = null, timeZone = null } = {}) {
  const owned = ownerCommitsOn(commits, day, timeZone)
  const stats = {
    commits: owned.length,
    linesAdded: 0, linesRemoved: 0, honestAdded: 0, honestRemoved: 0, codeAdded: 0, codeRemoved: 0,
    filesAdded: 0, filesModified: 0, filesDeleted: 0, aiAssistedCommits: 0, giantCommits: 0,
    ...prCountsOn(prs, day, timeZone),
    rawAdded: 0, rawRemoved: 0,
  }
  const dirs = new Map()
  const excluded = []
  for (const c of owned) {
    stats.linesAdded += c.linesAdded
    stats.linesRemoved += c.linesRemoved
    stats.rawAdded += c.rawLinesAdded ?? c.linesAdded
    stats.rawRemoved += c.rawLinesRemoved ?? c.linesRemoved
    stats.filesAdded += c.filesAdded
    stats.filesModified += c.filesModified
    stats.filesDeleted += c.filesDeleted
    if (c.aiAssisted) stats.aiAssistedCommits++
    if (c.giant) stats.giantCommits++
    if (c.giant || c.noise) {
      excluded.push({ sha: sha7(c.sha), subject: c.subject, linesAdded: c.linesAdded, reason: c.noise || c.giantReason || 'giant commit' })
      continue
    }
    stats.honestAdded += c.linesAdded
    stats.honestRemoved += c.linesRemoved
    stats.codeAdded += c.buckets.code.added
    stats.codeRemoved += c.buckets.code.removed
    for (const [dir, lines] of Object.entries(c.codeDirs || {})) dirs.set(dir, (dirs.get(dir) || 0) + lines)
  }
  return {
    repo: slug,
    day,
    stats,
    prNote,
    owners: { human: owned.filter((c) => c.identityClass === 'owner_human').length, agent: owned.filter((c) => c.identityClass === 'owner_agent').length },
    commits: owned.map((c) => ({ sha: sha7(c.sha), subject: c.subject, aiAssisted: Boolean(c.aiAssisted) })),
    topDirs: [...dirs.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_DIRS).map(([dir, linesChanged]) => ({ dir, linesChanged })),
    excluded,
  }
}

export function summaryLine({ stats }) {
  const prs = stats.prsMerged === null ? 'PRs n/a' : `${plural(stats.prsMerged, 'PR')} merged`
  const text = `${plural(stats.commits, 'commit')}, +${stats.honestAdded}/−${stats.honestRemoved} lines (code +${stats.codeAdded}), ${prs}`
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

export function bodyMarkdown(rd) {
  const s = rd.stats
  const prText = s.prsMerged === null ? `PRs n/a${rd.prNote ? ` (${rd.prNote})` : ''}` : `${plural(s.prsMerged, 'PR')} merged, ${s.prsOpened} opened`
  const lines = [
    `## ${rd.repo} · git · ${rd.day}`,
    '',
    `**${plural(s.commits, 'commit')}** · +${fmt(s.honestAdded)}/−${fmt(s.honestRemoved)} honest lines (code +${fmt(s.codeAdded)}/−${fmt(s.codeRemoved)}) · authored +${fmt(s.linesAdded)}/−${fmt(s.linesRemoved)} (raw +${fmt(s.rawAdded)}/−${fmt(s.rawRemoved)}) · ${s.aiAssistedCommits} AI-assisted · ${prText}`,
    '',
    '### Commits',
    ...rd.commits.slice(0, MAX_COMMITS).map((c) => `- \`${c.sha}\` ${c.subject}${c.aiAssisted ? ' (AI-assisted)' : ''}`),
  ]
  if (rd.commits.length > MAX_COMMITS) lines.push(`- …and ${rd.commits.length - MAX_COMMITS} more`)
  lines.push('', `**Files:** ${s.filesAdded} added · ${s.filesModified} modified · ${s.filesDeleted} deleted`)
  if (rd.topDirs.length) lines.push(`**Top dirs:** ${rd.topDirs.map((d) => `${d.dir} (${fmt(d.linesChanged)})`).join(', ')}`)
  if (rd.excluded.length) {
    lines.push(`**Imports/dumps excluded:** ${rd.excluded.map((e) => `\`${e.sha}\` ${e.subject} (+${fmt(e.linesAdded)} authored, ${e.reason})`).join('; ')}`)
  }
  return `${lines.join('\n')}\n`
}

/** POST /api/v1/memories body; deliberately no top-level `repo` key in sourceMetadata. */
export function buildPayload(rd) {
  const s = rd.stats
  return {
    title: `${rd.repo} · git · ${rd.day}`,
    type: 'observation',
    source: 'cron',
    summary: summaryLine(rd),
    bodyMd: bodyMarkdown(rd),
    tags: ['git-digest', `repo:${rd.repo}`],
    sourceMetadata: {
      kind: 'repo_git_digest',
      externalId: `git-digest:${rd.repo}:${rd.day}`,
      repoSlug: rd.repo,
      day: rd.day,
      stats: {
        commits: s.commits, linesAdded: s.linesAdded, linesRemoved: s.linesRemoved,
        honestAdded: s.honestAdded, honestRemoved: s.honestRemoved, codeAdded: s.codeAdded, codeRemoved: s.codeRemoved,
        filesAdded: s.filesAdded, filesModified: s.filesModified, filesDeleted: s.filesDeleted,
        aiAssistedCommits: s.aiAssistedCommits, giantCommits: s.giantCommits, prsOpened: s.prsOpened, prsMerged: s.prsMerged,
        rawAdded: s.rawAdded, rawRemoved: s.rawRemoved,
      },
      commits: rd.commits.slice(0, MAX_COMMITS),
    },
  }
}
