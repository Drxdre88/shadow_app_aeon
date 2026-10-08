import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { memories } from '@/lib/db/schema'
import { confidenceForStreamClass } from '@/lib/kairos/confidence'
import { normalizeRepoSlug } from '@/lib/kairos/living/repo-slug'
import { notHeldSensitive } from '@/lib/kairos/sensitive/held'
import { repoPlaybookMetaSchema, type RepoPlaybookMeta } from '@/lib/kairos/repo-memory/types'
import { parseSessionFacts, type SessionFacts } from '@/lib/kairos/repo-memory/facts'
import { REPO_GIT_DIGEST_KIND, parseRepoGitDigest, type RepoGitDigest } from '@/lib/kairos/repo-memory/git-digest'

// Repo memory: agent session summaries read per repo, and the one lessons
// playbook per repo the nightly repo_lessons job keeps. A playbook is type
// 'observation', streamClass 'trace', sourceMetadata { kind:'repo_playbook',
// externalKey:'repo_playbook:<slug>', repoSlug, playbook:{…} } — the slug is
// not stored as `repo`, so capture-repo readers never count it as a session.
// Pure DB access, user-scoped; held-sensitive rows are never read.

export const REPO_PLAYBOOK_KIND = 'repo_playbook'
export const repoPlaybookExternalKey = (slug: string) => `repo_playbook:${slug}`

const SNIPPET_BODY_CHARS = 1200

const rawRepo = sql<string | null>`coalesce(nullif(${memories.sourceMetadata}->>'repo', ''), ${memories.sourceMetadata}->'session'->>'repo')`
const rawClient = sql<string | null>`coalesce(nullif(${memories.sourceMetadata}->>'client', ''), ${memories.sourceMetadata}->'session'->>'client', ${memories.source})`

export interface RepoSessionRow {
  id: string
  repo: string
  title: string
  summary: string | null
  body: string
  client: string | null
  createdAt: Date
  facts?: SessionFacts | null
  taskId?: string
  projectId?: string
}

const SESSION_COLUMNS = {
  id: memories.id,
  title: memories.title,
  summary: memories.summary,
  body: sql<string>`left(${memories.bodyMd}, ${sql.raw(String(SNIPPET_BODY_CHARS))})`,
  rawRepo,
  client: rawClient,
  createdAt: memories.createdAt,
  record: sql<unknown>`${memories.sourceMetadata}->'session'`,
  hookCommits: sql<unknown>`${memories.sourceMetadata}->'commits'`,
  hookFiles: sql<unknown>`${memories.sourceMetadata}->'filesTouched'`,
  memoryTaskId: memories.taskId,
  memoryProjectId: memories.projectId,
}

type SessionSelect = {
  id: string; title: string; summary: string | null; body: string | null; rawRepo: string | null; client: string | null; createdAt: Date
  record?: unknown; hookCommits?: unknown; hookFiles?: unknown; memoryTaskId?: string | null; memoryProjectId?: string | null
}

const idOf = (...values: unknown[]): string | undefined =>
  values.find((v): v is string => typeof v === 'string' && v.trim() !== '')

// The card a session worked on: the session record's anchor, else the memory's own columns.
function anchorOf(r: SessionSelect): { taskId?: string; projectId?: string } {
  const record = r.record && typeof r.record === 'object' ? (r.record as Record<string, unknown>) : {}
  const taskId = idOf(record.taskId, r.memoryTaskId)
  const projectId = idOf(record.projectId, r.memoryProjectId)
  return { ...(taskId ? { taskId } : {}), ...(projectId ? { projectId } : {}) }
}

// The session record wins; the hook's top-level commits/files fill its gaps.
function factsOf(r: SessionSelect): SessionFacts | null {
  const record = r.record && typeof r.record === 'object' ? (r.record as Record<string, unknown>) : {}
  return parseSessionFacts({
    ...record,
    commits: Array.isArray(record.commits) ? record.commits : r.hookCommits,
    files: Array.isArray(record.files) ? record.files : r.hookFiles,
  })
}

function toSessionRow(r: SessionSelect): RepoSessionRow | null {
  const repo = normalizeRepoSlug(r.rawRepo)
  if (!repo) return null
  return { id: r.id, repo, title: r.title, summary: r.summary, body: r.body ?? '', client: r.client, createdAt: r.createdAt, facts: factsOf(r), ...anchorOf(r) }
}

const sessionWhere = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'session_summary'),
  isNull(memories.archivedAt),
  notHeldSensitive,
)

// Session summaries created in [since, until), newest first, with a repo.
export async function listSessionSummariesBetween(userId: string, since: Date, until: Date, limit = 200): Promise<RepoSessionRow[]> {
  const rows = await db
    .select(SESSION_COLUMNS)
    .from(memories)
    .where(and(sessionWhere(userId), gte(memories.createdAt, since), lt(memories.createdAt, until)))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
  return rows.flatMap((r) => toSessionRow(r) ?? [])
}

// The newest session summaries for one repo slug (any stored repo spelling
// whose last path segment is the slug).
export async function listRepoSessions(userId: string, slug: string, limit = 3): Promise<RepoSessionRow[]> {
  const rows = await db
    .select(SESSION_COLUMNS)
    .from(memories)
    .where(and(sessionWhere(userId), sql`lower(${rawRepo}) like ${`%${slug}%`}`))
    .orderBy(desc(memories.createdAt))
    .limit(Math.max(limit * 5, 20))
  return rows.flatMap((r) => {
    const row = toSessionRow(r)
    return row && row.repo === slug ? [row] : []
  }).slice(0, limit)
}

export interface RepoPlaybookRow {
  id: string
  slug: string
  playbook: RepoPlaybookMeta | null
  updatedAt: Date
}

const playbookWhere = (userId: string) => and(
  eq(memories.userId, userId),
  eq(memories.type, 'observation'),
  eq(memories.streamClass, 'trace'),
  isNull(memories.archivedAt),
  sql`${memories.sourceMetadata}->>'kind' = ${REPO_PLAYBOOK_KIND}`,
)

const externalKeyOf = sql<string>`${memories.sourceMetadata}->>'externalKey'`
const PLAYBOOK_COLUMNS = { id: memories.id, sourceMetadata: memories.sourceMetadata, updatedAt: memories.updatedAt }

function toPlaybookRow(r: { id: string; sourceMetadata: unknown; updatedAt: Date }): RepoPlaybookRow {
  const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>
  const parsed = repoPlaybookMetaSchema.safeParse(meta.playbook)
  return {
    id: r.id,
    slug: typeof meta.repoSlug === 'string' ? meta.repoSlug : '',
    playbook: parsed.success ? parsed.data : null,
    updatedAt: r.updatedAt,
  }
}

export async function listRepoPlaybooks(userId: string, slugs: readonly string[]): Promise<RepoPlaybookRow[]> {
  if (slugs.length === 0) return []
  const rows = await db
    .select(PLAYBOOK_COLUMNS)
    .from(memories)
    .where(and(playbookWhere(userId), notHeldSensitive, inArray(externalKeyOf, slugs.map(repoPlaybookExternalKey))))
    .orderBy(desc(memories.updatedAt))
  return rows.map(toPlaybookRow)
}

export async function findRepoPlaybook(userId: string, slug: string): Promise<RepoPlaybookRow | null> {
  const [row] = await listRepoPlaybooks(userId, [slug])
  return row ?? null
}

// Git digests (posted nightly from the owner's PC) created in [since, until),
// newest first; rows that do not parse as a digest are skipped.
export async function listRepoGitDigestsBetween(userId: string, since: Date, until: Date, limit = 100): Promise<RepoGitDigest[]> {
  const rows = await db
    .select({ id: memories.id, summary: memories.summary, sourceMetadata: memories.sourceMetadata })
    .from(memories)
    .where(and(
      eq(memories.userId, userId),
      eq(memories.type, 'observation'),
      isNull(memories.archivedAt),
      notHeldSensitive,
      sql`${memories.sourceMetadata}->>'kind' = ${REPO_GIT_DIGEST_KIND}`,
      gte(memories.createdAt, since),
      lt(memories.createdAt, until),
    ))
    .orderBy(desc(memories.createdAt))
    .limit(limit)
  return rows.flatMap((r) => parseRepoGitDigest(r) ?? [])
}

export interface RepoPlaybookValues {
  title: string
  bodyMd: string
  summary: string
  playbook: RepoPlaybookMeta
}

// One row per repo (advisory lock + lookup in one transaction): updated in
// place on a new night, left alone when the same job applies twice.
export async function upsertRepoPlaybook(
  userId: string,
  values: RepoPlaybookValues,
): Promise<{ memoryId: string; written: boolean }> {
  const slug = values.playbook.repo
  const externalKey = repoPlaybookExternalKey(slug)
  const sourceMetadata = { kind: REPO_PLAYBOOK_KIND, externalKey, repoSlug: slug, playbook: values.playbook }
  const text = { title: values.title.slice(0, 255), bodyMd: values.bodyMd, summary: values.summary.slice(0, 240) }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${externalKey}))`)
    const [existing] = await tx
      .select({ id: memories.id, sourceMetadata: memories.sourceMetadata })
      .from(memories)
      .where(and(playbookWhere(userId), sql`${externalKeyOf} = ${externalKey}`))
      .limit(1)
    if (existing) {
      const prior = repoPlaybookMetaSchema.safeParse(((existing.sourceMetadata ?? {}) as Record<string, unknown>).playbook)
      if (prior.success && prior.data.jobId === values.playbook.jobId) return { memoryId: existing.id, written: false }
      await tx
        .update(memories)
        .set({ ...text, sourceMetadata, embedding: null, embeddingModel: null, updatedAt: new Date() })
        .where(and(eq(memories.id, existing.id), eq(memories.userId, userId)))
      return { memoryId: existing.id, written: true }
    }
    const [inserted] = await tx
      .insert(memories)
      .values({
        userId,
        dominionId: null,
        ...text,
        type: 'observation',
        streamClass: 'trace',
        source: 'cron',
        confidence: confidenceForStreamClass('trace'),
        links: [],
        tags: [REPO_PLAYBOOK_KIND, `repo:${slug}`.slice(0, 60)],
        sourceMetadata,
        pinned: false,
      })
      .returning({ id: memories.id })
    if (!inserted) throw new Error('repo playbook insert returned no row')
    return { memoryId: inserted.id, written: true }
  })
}
