import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/data/thinking-jobs', () => ({ hasJobWithKeyLike: vi.fn() }))
vi.mock('@/lib/data/repo-memory', () => ({
  listSessionSummariesBetween: vi.fn(),
  listRepoGitDigestsBetween: vi.fn(),
  listRepoPlaybooks: vi.fn(),
  upsertRepoPlaybook: vi.fn(),
}))

import { hasJobWithKeyLike } from '@/lib/data/thinking-jobs'
import * as data from '@/lib/data/repo-memory'
import type { RepoSessionRow } from '@/lib/data/repo-memory'
import { parseRepoGitDigest, type RepoGitDigest } from '@/lib/kairos/repo-memory/git-digest'
import { parseRepoLessonsText } from '@/lib/kairos/repo-memory/prompt'
import { repoLessonsContextSchema } from '@/lib/kairos/repo-memory/types'
import { repoLessonsHandler } from '../handlers/repo-lessons'

const USER = 'user-1'
const NIGHT = new Date('2026-10-06T02:00:00.000Z')
const KEY = 'repo_lessons:2026-10-06'

const session = (id: string, repo: string, hoursAgo: number, o: Partial<RepoSessionRow> = {}): RepoSessionRow => ({
  id, repo, title: `Session ${id}`, summary: `Fixed the thing in ${repo}.`, body: '', client: 'claude',
  createdAt: new Date(NIGHT.getTime() - hoursAgo * 3_600_000), ...o,
})

const digest = (id: string, repoSlug: string, commits: number, subjects: string[] = []): RepoGitDigest => parseRepoGitDigest({
  id,
  summary: `${commits} commits, +10/−2 lines (code +8), 1 PRs merged`,
  sourceMetadata: {
    kind: 'repo_git_digest', externalId: `git-digest:${repoSlug}:2026-10-05`, repoSlug, day: '2026-10-05',
    stats: { commits, prsMerged: 1 }, commits: subjects.map((subject, i) => ({ sha: `abc${i}`, subject, aiAssisted: i === 0 })),
  },
})!

const priorPlaybook = {
  id: 'pb-aeon', slug: 'shadow_app_aeon', updatedAt: NIGHT,
  playbook: {
    v: 1 as const, repo: 'shadow_app_aeon', day: '2026-10-05', citations: ['old-1'], sessionCount: 2, jobId: 'job-old', answeredBy: 'routine',
    lessons: [{ kind: 'convention' as const, text: 'Run typecheck before tests.', sourceIds: ['old-1'] }],
  },
}

function job(overrides: Partial<ThinkingJobRow> = {}): ThinkingJobRow {
  return {
    id: 'job-rl', userId: USER, kind: 'repo_lessons', dominionId: null, externalKey: KEY, status: 'claimed',
    input: {
      system: 's', prompt: 'p', validMemoryIds: ['s1', 's2', 'old-1', 'e1'],
      context: {
        day: '2026-10-06',
        repos: [
          { slug: 'shadow_app_aeon', sessionIds: ['s1', 's2'], priorCitationIds: ['old-1'] },
          { slug: 'stp_app_ermac', sessionIds: ['e1'], priorCitationIds: [] },
        ],
      },
    },
    output: null, claimedBy: 'routine:brain', claimToken: 't', claimedAt: NIGHT, deadlineAt: NIGHT,
    completedAt: null, attempts: 1, error: null, createdAt: NIGHT, updatedAt: NIGHT,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KAIROS_REPO_MEMORY = '1'
  vi.mocked(hasJobWithKeyLike).mockResolvedValue(false)
  vi.mocked(data.listSessionSummariesBetween).mockResolvedValue([
    session('s1', 'shadow_app_aeon', 1),
    session('e1', 'stp_app_ermac', 3, { summary: null, body: '## Outcome\nShipped the ermac export.\nMore detail.' }),
    session('s2', 'shadow_app_aeon', 5),
  ])
  vi.mocked(data.listRepoPlaybooks).mockResolvedValue([priorPlaybook])
  vi.mocked(data.listRepoGitDigestsBetween).mockResolvedValue([])
  vi.mocked(data.upsertRepoPlaybook).mockImplementation(async (_u, v) => ({ memoryId: `pb-${v.playbook.repo}`, written: true }))
})

afterEach(() => { delete process.env.KAIROS_REPO_MEMORY })

describe('repo_lessons plan', () => {
  it('off: plans nothing and reads nothing', async () => {
    process.env.KAIROS_REPO_MEMORY = '0'
    expect(await repoLessonsHandler.plan(USER, NIGHT)).toEqual([])
    expect(hasJobWithKeyLike).not.toHaveBeenCalled()
    expect(data.listSessionSummariesBetween).not.toHaveBeenCalled()
  })

  it('plans nothing outside the nightly window', async () => {
    expect(await repoLessonsHandler.plan(USER, new Date('2026-10-06T01:39:00.000Z'))).toEqual([])
    expect(await repoLessonsHandler.plan(USER, new Date('2026-10-06T12:00:00.000Z'))).toEqual([])
    expect(data.listSessionSummariesBetween).not.toHaveBeenCalled()
  })

  it('plans once per day', async () => {
    vi.mocked(hasJobWithKeyLike).mockResolvedValue(true)
    expect(await repoLessonsHandler.plan(USER, NIGHT)).toEqual([])
    expect(hasJobWithKeyLike).toHaveBeenCalledWith(USER, 'repo_lessons', KEY)
  })

  it('skips the night when no repo had a session or a git digest', async () => {
    vi.mocked(data.listSessionSummariesBetween).mockResolvedValue([])
    expect(await repoLessonsHandler.plan(USER, NIGHT)).toEqual([])
    expect(data.listRepoGitDigestsBetween).toHaveBeenCalledWith(USER, expect.any(Date), NIGHT)
    expect(data.listRepoPlaybooks).not.toHaveBeenCalled()
  })

  it('a git-only repo is a candidate: digest block, citable digest id, ranked after session repos', async () => {
    vi.mocked(data.listRepoGitDigestsBetween).mockResolvedValue([
      digest('g-small', 'shadow_dev_lab', 2, ['fix: tiny']),
      digest('g-aeon', 'shadow_app_aeon', 5, ['feat: digest', 'Revert "feat: digest"']),
      digest('g-big', 'kal_el_dash', 30, ['feat: ```hostile```']),
    ])
    const [spec] = await repoLessonsHandler.plan(USER, NIGHT)
    const ctx = spec.input.context as { repos: Array<{ slug: string; digestIds: string[] }> }
    expect(ctx.repos.map((r) => [r.slug, r.digestIds])).toEqual([
      ['shadow_app_aeon', ['g-aeon']], ['stp_app_ermac', []], ['kal_el_dash', ['g-big']], ['shadow_dev_lab', ['g-small']],
    ])
    expect(spec.input.validMemoryIds).toEqual(expect.arrayContaining(['g-aeon', 'g-big', 'g-small']))
    const prompt = spec.input.prompt as string
    expect(prompt).toContain('## Repo: kal_el_dash')
    expect(prompt).toContain('- (no agent session — see the git block)')
    expect(prompt).toContain('### Git (whole day, from the owner’s PC; ids you may cite)\n- [g-aeon] 2026-10-05: 5 commits, +10/−2 lines (code +8), 1 PRs merged\n  - feat: digest (AI-assisted)\n  - Revert "feat: digest"\n  - (+3 more commits)')
    expect(prompt).not.toContain('```')
    expect(spec.input.system).toContain('Git (whole day, from the owner’s PC)')
  })

  it('plans for a night with only git digests', async () => {
    vi.mocked(data.listSessionSummariesBetween).mockResolvedValue([])
    vi.mocked(data.listRepoGitDigestsBetween).mockResolvedValue([digest('g1', 'stp_app_relic', 4)])
    const [spec] = await repoLessonsHandler.plan(USER, NIGHT)
    expect(spec.input.context).toEqual({ day: '2026-10-06', repos: [{ slug: 'stp_app_relic', sessionIds: [], priorCitationIds: [], digestIds: ['g1'] }] })
  })

  it('one batched job: last 24h of sessions per repo, the previous playbook, citable ids', async () => {
    const [spec, ...rest] = await repoLessonsHandler.plan(USER, NIGHT)
    expect(rest).toEqual([])
    expect(spec.kind).toBe('repo_lessons')
    expect(spec.externalKey).toBe(KEY)
    expect(spec.deadlineMinutes).toBeCloseTo(148, 5)
    const [, since, until] = vi.mocked(data.listSessionSummariesBetween).mock.calls[0]
    expect(since.toISOString()).toBe('2026-10-05T02:00:00.000Z')
    expect(until).toBe(NIGHT)
    expect(spec.input.context).toEqual({
      day: '2026-10-06',
      repos: [
        { slug: 'shadow_app_aeon', sessionIds: ['s1', 's2'], priorCitationIds: ['old-1'], digestIds: [] },
        { slug: 'stp_app_ermac', sessionIds: ['e1'], priorCitationIds: [], digestIds: [] },
      ],
    })
    expect(new Set(spec.input.validMemoryIds)).toEqual(new Set(['s1', 's2', 'old-1', 'e1']))
    expect(spec.input.prompt).toContain('## Repo: shadow_app_aeon')
    expect(spec.input.prompt).toContain('[s1]')
    expect(spec.input.prompt).toContain('Run typecheck before tests. [old-1]')
    expect(spec.input.prompt).toContain('Session e1 — ## Outcome Shipped the ermac export.')
  })
})

const answer = (repos: unknown) => '```json\n' + JSON.stringify({ repos }) + '\n```'

describe('repo_lessons apply', () => {
  it('writes one playbook per repo and drops ids that are not in that repo’s context', async () => {
    const res = await repoLessonsHandler.apply(job(), answer([
      {
        repo: 'shadow_app_aeon',
        lessons: [
          { kind: 'worked', text: 'Splitting files kept reviews small.', sourceIds: ['s1', 'made-up'] },
          { kind: 'trap', text: 'Invented.', sourceIds: ['nope'] },
          { kind: 'Convention', text: 'Run typecheck before tests.', sourceIds: ['old-1'] },
          { kind: 'broke', text: 'Cites another repo.', sourceIds: ['e1'] },
        ],
      },
      { repo: 'stp_app_ermac', lessons: [{ kind: 'trap', text: 'Exports need the lock.', sourceIds: ['e1'] }] },
      { repo: 'shadow_app_unknown', lessons: [{ kind: 'trap', text: 'Not in context.', sourceIds: ['s1'] }] },
    ]), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['pb-shadow_app_aeon', 'pb-stp_app_ermac'], output: { dropped: 3, answeredBy: 'routine' } })
    const [, aeon] = vi.mocked(data.upsertRepoPlaybook).mock.calls[0]
    expect(aeon.playbook).toEqual({
      v: 1, repo: 'shadow_app_aeon', day: '2026-10-06', sessionCount: 2, jobId: 'job-rl', answeredBy: 'routine',
      citations: ['s1', 'old-1'],
      lessons: [
        { kind: 'worked', text: 'Splitting files kept reviews small.', sourceIds: ['s1'] },
        { kind: 'convention', text: 'Run typecheck before tests.', sourceIds: ['old-1'] },
      ],
    })
    expect(aeon.title).toBe('Lessons · shadow_app_aeon')
    expect(aeon.bodyMd).toContain('**What worked:** Splitting files kept reviews small. _(from s1)_')
  })

  it('caps a repo at ten lessons', async () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ kind: 'worked', text: `Lesson ${i}`, sourceIds: ['s1'] }))
    await repoLessonsHandler.apply(job(), answer([{ repo: 'shadow_app_aeon', lessons: many }]), 'routine')
    expect(vi.mocked(data.upsertRepoPlaybook).mock.calls[0][1].playbook.lessons).toHaveLength(10)
  })

  it('rejects an answer where nothing grounds, and writes nothing', async () => {
    const res = await repoLessonsHandler.apply(job(), answer([{ repo: 'shadow_app_aeon', lessons: [{ kind: 'trap', text: 'x', sourceIds: ['nope'] }] }]), 'routine')
    expect(res).toEqual({ ok: false, reason: expect.stringMatching(/^ungrounded/) })
    expect(data.upsertRepoPlaybook).not.toHaveBeenCalled()
  })

  it('rejects malformed output and a bad context', async () => {
    expect(await repoLessonsHandler.apply(job(), 'no json here', 'routine')).toEqual({ ok: false, reason: expect.stringMatching(/^parse_failed/) })
    expect(await repoLessonsHandler.apply(job({ input: { system: 's', prompt: 'p' } }), answer([]), 'routine'))
      .toEqual({ ok: false, reason: 'bad_job: invalid repo_lessons context' })
  })

  it('a re-applied job reports the rows it left alone', async () => {
    vi.mocked(data.upsertRepoPlaybook).mockResolvedValue({ memoryId: 'pb', written: false })
    const res = await repoLessonsHandler.apply(job(), answer([{ repo: 'stp_app_ermac', lessons: [{ kind: 'trap', text: 'x', sourceIds: ['e1'] }] }]), 'routine')
    expect(res).toMatchObject({ ok: true, output: { alreadyRecorded: 1 } })
  })

  it('switched off between plan and apply: writes nothing', async () => {
    process.env.KAIROS_REPO_MEMORY = '0'
    const res = await repoLessonsHandler.apply(job(), answer([{ repo: 'stp_app_ermac', lessons: [{ kind: 'trap', text: 'x', sourceIds: ['e1'] }] }]), 'routine')
    expect(res).toEqual({ ok: true, memoryIds: [], output: { skipped: 'repo_memory_off', answeredBy: 'routine' } })
    expect(data.upsertRepoPlaybook).not.toHaveBeenCalled()
  })

  it('has no fallback', async () => {
    expect(await repoLessonsHandler.fallback(job())).toEqual({ ok: false, reason: 'no fallback — the lessons note waits for the next night' })
  })

  it('a job queued before digests (no digestIds) still parses and applies', async () => {
    expect(repoLessonsContextSchema.parse(job().input.context).repos[0].digestIds).toEqual([])
    const res = await repoLessonsHandler.apply(job(), answer([{ repo: 'stp_app_ermac', lessons: [{ kind: 'trap', text: 'x', sourceIds: ['e1'] }] }]), 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['pb-stp_app_ermac'] })
  })

  it('accepts lessons citing a git digest id under its own repo only', async () => {
    const context = {
      day: '2026-10-06',
      repos: [
        { slug: 'kal_el_dash', sessionIds: [], priorCitationIds: [], digestIds: ['g-big'] },
        { slug: 'stp_app_ermac', sessionIds: ['e1'], priorCitationIds: [], digestIds: [] },
      ],
    }
    const text = answer([
      { repo: 'kal_el_dash', lessons: [{ kind: 'broke', text: 'A revert followed the export change.', sourceIds: ['g-big'] }] },
      { repo: 'stp_app_ermac', lessons: [{ kind: 'trap', text: 'Wrong repo.', sourceIds: ['g-big'] }] },
    ])
    expect(parseRepoLessonsText(text, context)).toEqual({
      dropped: 1,
      repos: [{ repo: 'kal_el_dash', citations: ['g-big'], lessons: [{ kind: 'broke', text: 'A revert followed the export change.', sourceIds: ['g-big'] }] }],
    })
    const res = await repoLessonsHandler.apply(job({ input: { system: 's', prompt: 'p', context } }), text, 'routine')
    expect(res).toMatchObject({ ok: true, memoryIds: ['pb-kal_el_dash'] })
    expect(vi.mocked(data.upsertRepoPlaybook).mock.calls[0][1].playbook).toMatchObject({ citations: ['g-big'], sessionCount: 0 })
  })
})
