import type {
  ApplyOutcome,
  ThinkingAnsweredBy,
  ThinkingJobHandler,
  ThinkingJobKind,
  ThinkingJobRow,
  ThinkingJobSpec,
} from '@/lib/kairos/engine/types'
import { repoMemoryMode } from '@/lib/kairos/repo-memory/flag'
import { groupRepoActivity } from '@/lib/kairos/repo-memory/inputs'
import {
  REPO_LESSONS_MAX_OUTPUT_TOKENS,
  REPO_LESSONS_SYSTEM_PROMPT,
  buildRepoLessonsPrompt,
  citableIdsFor,
  parseRepoLessonsText,
  type ParsedRepoLessonsAnswer,
  type RepoLessonsRepoInput,
} from '@/lib/kairos/repo-memory/prompt'
import { renderPlaybookMarkdown } from '@/lib/kairos/repo-memory/render'
import { repoLessonsContextSchema, type RepoLessonsContext } from '@/lib/kairos/repo-memory/types'
import { minutesLeftInWindow, utcDay, type UtcWindow } from '../deadlines'
import { errorReason } from './_errors'

// Repo lessons (Workforce, deep tier, brain routine). plan: only with
// KAIROS_REPO_MEMORY on (off returns [] before any read), once per UTC day in
// the nightly window (key repo_lessons:<YYYY-MM-DD>), skipped when no repo had
// an agent session or a git digest in the last 24 hours (git-only repos are
// candidates too; ranking in groupRepoActivity). apply: one playbook memory per repo
// (repo_playbook:<slug>); lessons whose ids do not ground under that repo are
// dropped. Never writes to a repo or a board. No fallback — the lessons note
// waits for the next night. lib/data is imported lazily.

export const REPO_LESSONS_KIND: ThinkingJobKind = 'repo_lessons'
export const REPO_LESSONS_WINDOW_UTC: UtcWindow = { notBefore: { hour: 1, minute: 40 }, deadline: { hour: 4, minute: 28 } }
export const repoLessonsJobKey = (day: string) => `repo_lessons:${day}`

const DAY_MS = 86_400_000

function readContext(job: ThinkingJobRow): RepoLessonsContext | null {
  const parsed = repoLessonsContextSchema.safeParse(job.input?.context)
  return parsed.success ? parsed.data : null
}

async function plan(userId: string, now: Date): Promise<ThinkingJobSpec[]> {
  if (repoMemoryMode() === 'off') return []
  const deadlineMinutes = minutesLeftInWindow(now, REPO_LESSONS_WINDOW_UTC)
  if (deadlineMinutes <= 0) return []
  const day = utcDay(now)
  const externalKey = repoLessonsJobKey(day)
  const { hasJobWithKeyLike } = await import('@/lib/data/thinking-jobs')
  if (await hasJobWithKeyLike(userId, REPO_LESSONS_KIND, externalKey)) return []

  const data = await import('@/lib/data/repo-memory')
  const since = new Date(now.getTime() - DAY_MS)
  const [sessions, digests] = await Promise.all([
    data.listSessionSummariesBetween(userId, since, now),
    data.listRepoGitDigestsBetween(userId, since, now),
  ])
  const groups = groupRepoActivity(sessions, digests)
  if (groups.length === 0) return []
  const playbooks = await data.listRepoPlaybooks(userId, groups.map((g) => g.slug))
  const inputs: RepoLessonsRepoInput[] = groups.map((g) => ({
    slug: g.slug,
    sessions: g.sessions,
    digests: g.digests,
    playbook: playbooks.find((p) => p.slug === g.slug)?.playbook ?? null,
  }))
  const repos = inputs.map((r) => ({ slug: r.slug, ...citableIdsFor(r) }))
  return [{
    kind: REPO_LESSONS_KIND,
    dominionId: null,
    externalKey,
    deadlineMinutes,
    input: {
      system: REPO_LESSONS_SYSTEM_PROMPT,
      prompt: buildRepoLessonsPrompt(day, inputs),
      validMemoryIds: [...new Set(repos.flatMap((r) => [...r.sessionIds, ...r.digestIds, ...r.priorCitationIds]))],
      maxOutputTokens: REPO_LESSONS_MAX_OUTPUT_TOKENS,
      context: { day, repos } satisfies RepoLessonsContext,
    },
  }]
}

async function apply(job: ThinkingJobRow, text: string, answeredBy: ThinkingAnsweredBy): Promise<ApplyOutcome> {
  const ctx = readContext(job)
  if (!ctx) return { ok: false, reason: 'bad_job: invalid repo_lessons context' }
  if (repoMemoryMode() === 'off') return { ok: true, memoryIds: [], output: { skipped: 'repo_memory_off', answeredBy } }

  let parsed: ParsedRepoLessonsAnswer
  try {
    parsed = parseRepoLessonsText(text, ctx)
  } catch (err) {
    return { ok: false, reason: `parse_failed: ${errorReason(err)}` }
  }
  if (parsed.repos.length === 0) {
    return { ok: false, reason: `ungrounded: no lesson cites a listed id under its repo (dropped ${parsed.dropped})` }
  }

  const { upsertRepoPlaybook } = await import('@/lib/data/repo-memory')
  const memoryIds: string[] = []
  let unchanged = 0
  for (const r of parsed.repos) {
    const sessionCount = ctx.repos.find((c) => c.slug === r.repo)?.sessionIds.length ?? 0
    const count = `${r.lessons.length} lesson${r.lessons.length === 1 ? '' : 's'}`
    const res = await upsertRepoPlaybook(job.userId, {
      title: `Lessons · ${r.repo}`,
      bodyMd: renderPlaybookMarkdown(r.repo, ctx.day, r.lessons),
      summary: `${count} for ${r.repo}, updated ${ctx.day}.`,
      playbook: { v: 1, repo: r.repo, day: ctx.day, lessons: r.lessons, citations: r.citations, sessionCount, jobId: job.id, answeredBy },
    })
    memoryIds.push(res.memoryId)
    if (!res.written) unchanged++
  }
  return {
    ok: true,
    memoryIds,
    output: {
      day: ctx.day,
      repos: parsed.repos.map((r) => ({ repo: r.repo, lessons: r.lessons.length })),
      dropped: parsed.dropped,
      ...(unchanged ? { alreadyRecorded: unchanged } : {}),
      answeredBy,
    },
  }
}

async function fallback(): Promise<ApplyOutcome> {
  return { ok: false, reason: 'no fallback — the lessons note waits for the next night' }
}

export const repoLessonsHandler: ThinkingJobHandler = {
  kind: REPO_LESSONS_KIND,
  plan,
  apply,
  fallback,
}
