import { z } from 'zod'
import { normalizeRepoSlug } from '@/lib/kairos/living/repo-slug'

// The per-repo git digest memory posted nightly from the owner's PC
// (type 'observation', sourceMetadata.kind 'repo_git_digest', one per repo
// per day; no top-level `repo`, so session readers never count it). Parsed
// junk-safe: a row without a usable slug or day is skipped, bad stats read 0.

export const REPO_GIT_DIGEST_KIND = 'repo_git_digest'
export const REPO_DIGEST_COMMITS_SHOWN = 8
const SUBJECT_MAX = 120
const SUMMARY_MAX = 240

const count = z.number().finite().nonnegative().transform(Math.round).catch(0)

const STAT_KEYS = [
  'commits', 'linesAdded', 'linesRemoved', 'honestAdded', 'honestRemoved', 'codeAdded', 'codeRemoved',
  'filesAdded', 'filesModified', 'filesDeleted', 'aiAssistedCommits', 'giantCommits', 'prsOpened', 'prsMerged',
] as const

export const repoGitDigestStatsSchema = z.object(
  Object.fromEntries(STAT_KEYS.map((k) => [k, count])) as Record<(typeof STAT_KEYS)[number], typeof count>,
)
export type RepoGitDigestStats = z.infer<typeof repoGitDigestStatsSchema>

const commitSchema = z.object({
  sha: z.string().catch(''),
  subject: z.string().transform((s) => s.replace(/\s+/g, ' ').trim()).pipe(z.string().min(1).max(SUBJECT_MAX * 4)),
  aiAssisted: z.boolean().catch(false),
})

const digestMetaSchema = z.object({
  kind: z.literal(REPO_GIT_DIGEST_KIND),
  repoSlug: z.string(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stats: z.unknown(),
  commits: z.unknown(),
})

export interface RepoGitDigestCommit { sha: string; subject: string; aiAssisted: boolean }

export interface RepoGitDigest {
  id: string
  slug: string
  day: string
  summary: string
  stats: RepoGitDigestStats
  commits: RepoGitDigestCommit[]
}

const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function statsOf(raw: unknown): RepoGitDigestStats {
  const parsed = repoGitDigestStatsSchema.safeParse(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {})
  return parsed.success ? parsed.data : repoGitDigestStatsSchema.parse({})
}

function commitsOf(raw: unknown): RepoGitDigestCommit[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((c) => {
    const p = commitSchema.safeParse(c)
    return p.success ? [{ sha: p.data.sha.slice(0, 12), subject: clipText(p.data.subject, SUBJECT_MAX), aiAssisted: p.data.aiAssisted }] : []
  }).slice(0, REPO_DIGEST_COMMITS_SHOWN)
}

export const fallbackDigestSummary = (s: RepoGitDigestStats) =>
  `${s.commits} commits, +${s.linesAdded}/−${s.linesRemoved} lines (code +${s.codeAdded}), ${s.prsMerged} PRs merged`

/** Null when the row is not a usable git digest (wrong kind, no slug, bad day). */
export function parseRepoGitDigest(row: { id: string; summary: string | null; sourceMetadata: unknown }): RepoGitDigest | null {
  const meta = digestMetaSchema.safeParse(row.sourceMetadata)
  if (!meta.success) return null
  const slug = normalizeRepoSlug(meta.data.repoSlug)
  if (!slug || !/^[\w.-]+$/.test(slug)) return null
  const stats = statsOf(meta.data.stats)
  const summary = row.summary?.replace(/\s+/g, ' ').trim() || fallbackDigestSummary(stats)
  return { id: row.id, slug, day: meta.data.day, summary: clipText(summary, SUMMARY_MAX), stats, commits: commitsOf(meta.data.commits) }
}
