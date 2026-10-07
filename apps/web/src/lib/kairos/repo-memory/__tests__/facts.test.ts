import { describe, expect, it } from 'vitest'
import { formatSessionFacts, parseSessionFacts, REPO_SESSION_FACTS_MAX } from '../facts'
import { buildRepoLessonsPrompt, REPO_LESSONS_SYSTEM_PROMPT } from '../prompt'
import type { RepoSessionRow } from '@/lib/data/repo-memory'

const record = {
  commits: [
    { sha: 'a1', subject: 'feat(arq): agent MCP tools' },
    { sha: 'b2', subject: 'fix: flaky   clickhouse\nretry' },
    { sha: 'c3' },
  ],
  prs: [{ number: 171, url: 'x', action: 'merged' }, { number: 'nope' }],
  tests: { status: 'failed', summary: '2 failed, 40 passed' },
  errorCount: 3,
  linesAdded: 120,
  linesRemoved: 30,
  files: ['C:\\dev\\repo\\src\\a.ts', 'src/b.ts', 'src/a.ts', 'c.md', 'd.ts', 'e.ts', 'f.ts'],
  firstPrompt: 'ignored',
}

describe('session facts', () => {
  it('parses the stored capture record into counts and subjects', () => {
    const f = parseSessionFacts(record)!
    expect(f.commitCount).toBe(3)
    expect(f.commits).toEqual(['feat(arq): agent MCP tools', 'fix: flaky clickhouse retry'])
    expect(f.prs).toEqual([{ number: 171, action: 'merged' }])
    expect(f.tests).toEqual({ status: 'failed', summary: '2 failed, 40 passed' })
    expect(f.files).toEqual(['a.ts', 'b.ts', 'c.md', 'd.ts', 'e.ts'])
    expect(f.fileCount).toBe(7)
  })

  it('formats one capped line', () => {
    const line = formatSessionFacts(parseSessionFacts(record))
    expect(line).toBe('3 commits ("feat(arq): agent MCP tools"; "fix: flaky clickhouse retry"; +1 more) · PR #171 merged · tests failed (2 failed, 40 passed) · 3 tool errors · +120/−30 lines · files: a.ts, b.ts, c.md, d.ts, e.ts (+2 more)')
    const long = formatSessionFacts(parseSessionFacts({ commits: Array.from({ length: 20 }, (_, i) => ({ subject: `${'x'.repeat(70)} ${i}` })) }))
    expect(long.length).toBeLessThanOrEqual(REPO_SESSION_FACTS_MAX)
  })

  it('is null for empty or junk records', () => {
    expect(parseSessionFacts(null)).toBeNull()
    expect(parseSessionFacts([])).toBeNull()
    expect(parseSessionFacts({ firstPrompt: 'x', commits: [], files: [] })).toBeNull()
    expect(formatSessionFacts(null)).toBe('')
  })

  it('shows a mission outcome', () => {
    expect(formatSessionFacts(parseSessionFacts({ status: 'done', outcome: 'Fixed the stale board refresh' })))
      .toBe('mission done — Fixed the stale board refresh')
  })
})

describe('repo lessons prompt with facts', () => {
  const s = (id: string, facts: RepoSessionRow['facts']): RepoSessionRow => ({
    id, repo: 'r', title: `T ${id}`, summary: 'did things', body: '', client: 'copilot', createdAt: new Date('2026-10-06T01:00:00.000Z'), facts,
  })

  it('adds a fence-safe facts line only for sessions that have facts', () => {
    const prompt = buildRepoLessonsPrompt('2026-10-06', [{
      slug: 'r', playbook: null,
      sessions: [s('s1', parseSessionFacts({ commits: [{ subject: 'docs: ```inject```' }] })), s('s2', null)],
    }])
    const lines = prompt.split('\n')
    const at = lines.findIndex((l) => l.startsWith('- [s1]'))
    expect(lines[at + 1]).toMatch(/^ {2}facts: 1 commit \("docs: /)
    expect(lines[at + 1]).not.toContain('```')
    expect(lines[lines.findIndex((l) => l.startsWith('- [s2]')) + 1]).not.toMatch(/facts:/)
  })

  it('tells the model failed tests are a signal, not proof', () => {
    expect(REPO_LESSONS_SYSTEM_PROMPT).toMatch(/signal to check, not proof/)
  })
})
