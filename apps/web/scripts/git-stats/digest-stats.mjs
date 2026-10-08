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

/** Extractor's aiAttributed/aiReason when present; else agent identity, AI trailer, or owner commit on/after the agent era. */
export function aiAttribution(c, { agentEraStart = null, day = null } = {}) {
  if ('aiAttributed' in c && c.aiAttributed !== undefined) return { ai: Boolean(c.aiAttributed), reason: c.aiReason ?? null }
  if (c.identityClass === 'owner_agent') return { ai: true, reason: 'agent_identity' }
  if (c.aiAssisted) return { ai: true, reason: 'trailer' }
  const commitDay = day || String(c.authorDate || '').slice(0, 10)
  if (agentEraStart && OWNER_CLASSES.has(c.identityClass) && commitDay >= agentEraStart) return { ai: true, reason: 'agent_era' }
  return { ai: false, reason: null }
}

/** Per repo-day aggregate stored locally and used to build the Aeon payload; every counted owner commit counts in full. */
export function buildRepoDay(slug, day, commits, { prs = null, prNote = null, timeZone = null, agentEraStart = null } = {}) {
  const owned = ownerCommitsOn(commits, day, timeZone)
  const stats = {
    commits: owned.length,
    linesAdded: 0, linesRemoved: 0, honestAdded: 0, honestRemoved: 0, codeAdded: 0, codeRemoved: 0,
    filesAdded: 0, filesModified: 0, filesDeleted: 0, aiAssistedCommits: 0, giantCommits: 0,
    ...prCountsOn(prs, day, timeZone),
    rawAdded: 0, rawRemoved: 0, aiCommits: 0, aiCodeAdded: 0,
  }
  const dirs = new Map()
  const bigDrops = []
  const listed = []
  for (const c of owned) {
    const ai = aiAttribution(c, { agentEraStart, day })
    stats.linesAdded += c.linesAdded
    stats.linesRemoved += c.linesRemoved
    stats.honestAdded += c.linesAdded
    stats.honestRemoved += c.linesRemoved
    stats.codeAdded += c.buckets.code.added
    stats.codeRemoved += c.buckets.code.removed
    stats.rawAdded += c.rawLinesAdded ?? c.linesAdded
    stats.rawRemoved += c.rawLinesRemoved ?? c.linesRemoved
    stats.filesAdded += c.filesAdded
    stats.filesModified += c.filesModified
    stats.filesDeleted += c.filesDeleted
    if (c.aiAssisted) stats.aiAssistedCommits++
    if (ai.ai) {
      stats.aiCommits++
      stats.aiCodeAdded += c.buckets.code.added
    }
    if (c.giant) stats.giantCommits++
    if (c.giant || c.noise) bigDrops.push({ sha: sha7(c.sha), subject: c.subject, linesAdded: c.linesAdded, reason: c.noise || c.giantReason || 'giant commit' })
    for (const [dir, lines] of Object.entries(c.codeDirs || {})) dirs.set(dir, (dirs.get(dir) || 0) + lines)
    listed.push({ sha: sha7(c.sha), subject: c.subject, aiAssisted: Boolean(c.aiAssisted), aiAttributed: ai.ai, aiReason: ai.reason })
  }
  return {
    repo: slug,
    day,
    stats,
    prNote,
    owners: { human: owned.filter((c) => c.identityClass === 'owner_human').length, agent: owned.filter((c) => c.identityClass === 'owner_agent').length },
    commits: listed,
    topDirs: [...dirs.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_DIRS).map(([dir, linesChanged]) => ({ dir, linesChanged })),
    bigDrops,
  }
}

export function summaryLine({ stats }) {
  const prs = stats.prsMerged === null ? 'PRs n/a' : `${plural(stats.prsMerged, 'PR')} merged`
  const text = `${plural(stats.commits, 'commit')}, +${stats.honestAdded}/−${stats.honestRemoved} lines (code +${stats.codeAdded}), ${prs}`
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

export function bodyMarkdown(rd) {
  const s = rd.stats
  const prText = s.prsMerged === null ? `n/a${rd.prNote ? ` (${rd.prNote})` : ''}` : `${s.prsMerged} merged, ${s.prsOpened} opened`
  const lines = [
    `## ${rd.repo} · git · ${rd.day}`,
    '',
    `**${plural(s.commits, 'commit')} (${s.aiCommits} by AI)** · code +${fmt(s.codeAdded)}/−${fmt(s.codeRemoved)} · authored +${fmt(s.linesAdded)}/−${fmt(s.linesRemoved)} (raw +${fmt(s.rawAdded)}/−${fmt(s.rawRemoved)})`,
    `**PRs:** ${prText}`,
    '',
    '### Commits',
    ...rd.commits.slice(0, MAX_COMMITS).map((c) => `- \`${c.sha}\` ${c.subject}${c.aiAssisted ? ' (AI-assisted)' : ''}`),
  ]
  if (rd.commits.length > MAX_COMMITS) lines.push(`- …and ${rd.commits.length - MAX_COMMITS} more`)
  lines.push('', `**Files:** ${s.filesAdded} added · ${s.filesModified} modified · ${s.filesDeleted} deleted`)
  if (rd.topDirs.length) lines.push(`**Top dirs:** ${rd.topDirs.map((d) => `${d.dir} (${fmt(d.linesChanged)})`).join(', ')}`)
  if (rd.bigDrops.length) {
    lines.push(`**Big drops (included above):** ${rd.bigDrops.map((e) => `\`${e.sha}\` ${e.subject} (+${fmt(e.linesAdded)} authored, ${e.reason})`).join('; ')}`)
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
        rawAdded: s.rawAdded, rawRemoved: s.rawRemoved, aiCommits: s.aiCommits, aiCodeAdded: s.aiCodeAdded,
      },
      commits: rd.commits.slice(0, MAX_COMMITS),
    },
  }
}
