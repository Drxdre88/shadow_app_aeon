import { describe, it, expect } from 'vitest'
import { buildSessionRecord, sessionRecordV1Schema } from '../session-record'

describe('session record v1', () => {
  it('stamps v and requires only client + sessionId', () => {
    expect(buildSessionRecord({ client: 'claude', sessionId: 's-1' })).toEqual({ v: 1, client: 'claude', sessionId: 's-1' })
    expect(sessionRecordV1Schema.safeParse({ v: 1, client: 'codex' }).success).toBe(false)
  })

  it('caps firstPrompt at 500 chars and files at 50, dropping empty keys', () => {
    const record = buildSessionRecord({
      client: 'copilot',
      sessionId: 's-2',
      firstPrompt: 'x'.repeat(900),
      files: Array.from({ length: 80 }, (_, i) => `f${i}.ts`),
      questions: [],
      branch: undefined,
    })
    expect(record.firstPrompt).toHaveLength(500)
    expect(record.files).toHaveLength(50)
    expect('questions' in record).toBe(false)
    expect('branch' in record).toBe(false)
  })

  it('accepts the full flat shape the capture scripts write', () => {
    const parsed = sessionRecordV1Schema.safeParse({
      v: 1, client: 'claude', sessionId: 's-3', hangarSessionId: 'h', taskId: 't', projectId: 'p',
      repo: 'shadow_app_aeon', registrySlug: 'aeon', worktree: false, startedAt: '2026-09-30T10:00:00Z',
      endedAt: '2026-09-30T11:00:00Z', durationMin: 60, firstPrompt: 'hi', objective: 'implement', cardName: 'c',
      status: 'abandoned', outcome: 'o', questions: ['q'], branch: 'b', commits: [{ sha: 'a', subject: 's' }],
      prs: [{ number: 1, url: 'https://github.com/x/y/pull/1', action: 'created' }], tests: { status: 'passed' },
      model: 'm', inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, costUsd: 0.1, linesAdded: 4, linesRemoved: 5,
      toolCalls: { Bash: 3 }, errorCount: 0, files: ['a.ts'], futureKey: 'tolerated',
    })
    expect(parsed.success).toBe(true)
  })
})
