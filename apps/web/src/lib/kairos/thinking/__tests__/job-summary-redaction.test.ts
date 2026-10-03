import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ThinkingJobKind, ThinkingJobRow } from '@/lib/kairos/engine/types'

vi.mock('@/lib/data/thinking-jobs', () => ({ listJobs: vi.fn() }))
vi.mock('../registry', () => ({ getThinkingHandlers: () => [] }))
vi.mock('@/lib/kairos/paid-backup', () => ({ isPaidBackupEnabled: vi.fn(async () => true), PAID_BACKUP_OFF_NOTE: 'off' }))

import { listJobs } from '@/lib/data/thinking-jobs'
import { listThinkingJobs, toJobSummary } from '../queue'

// Dream text lives only in job output; the shared MCP/REST listing
// (list_thinking_jobs / GET /api/v1/kairos/thinking-jobs) redacts it.

const NOW = new Date('2026-10-03T03:00:00Z')
const SRC = path.resolve(__dirname, '../../../..')

function job(kind: ThinkingJobKind, output: Record<string, unknown> | null): ThinkingJobRow {
  return {
    id: `${kind}-1`, userId: 'u1', kind, dominionId: null, externalKey: `${kind}:2026-10-03`, status: 'done',
    input: { system: 's', prompt: 'secret prompt' }, output, claimedBy: 'routine', claimToken: null, claimedAt: NOW,
    deadlineAt: NOW, completedAt: NOW, attempts: 1, error: null, createdAt: NOW, updatedAt: NOW,
  }
}

const DREAM_OUT = { dreamt: true, v: 1, date: '2026-10-03', title: 'The desk at sea', dream: 'secret dream text', scenes: [{ memoryId: 'm', distortion: 'swap_who', text: 'secret scene' }], fingerprints: ['ab'] }
const READ_OUT = { dreamt: true, v: 1, date: '2026-10-03', dreamJobId: 'dream-1', holds: [{ pattern: 'secret pattern', memoryIds: ['m'] }], fragile: [], rehearsal: null, morningLine: 'I dreamt secretly' }

describe('toJobSummary — dream redaction', () => {
  it('dream kinds show only that a dream ran and its title', () => {
    expect(toJobSummary(job('dream', DREAM_OUT)).output).toEqual({ dreamt: true, redacted: true, title: 'The desk at sea' })
    expect(toJobSummary(job('dream_read', READ_OUT)).output).toEqual({ dreamt: true, redacted: true, title: null })
    expect(toJobSummary(job('dream', null)).output).toEqual({ dreamt: true, redacted: true, title: null })
    expect(JSON.stringify(toJobSummary(job('dream', DREAM_OUT)))).not.toContain('secret')
  })

  it('every other kind passes output through unchanged', () => {
    const out = { draft: 'hello', memoryIds: [] }
    expect(toJobSummary(job('daily_message', out)).output).toBe(out)
  })

  it('listThinkingJobs (shared by MCP and REST) redacts', async () => {
    vi.mocked(listJobs).mockResolvedValue([job('dream', DREAM_OUT), job('dream_read', READ_OUT)])
    const { jobs } = await listThinkingJobs('u1')
    expect(JSON.stringify(jobs)).not.toMatch(/secret|I dreamt/)
  })

  it('MCP tool and REST route both list through listThinkingJobs', () => {
    const mcp = readFileSync(path.join(SRC, 'app/api/[transport]/tools/thinking.ts'), 'utf8')
    const rest = readFileSync(path.join(SRC, 'app/api/v1/kairos/thinking-jobs/route.ts'), 'utf8')
    for (const src of [mcp, rest]) {
      expect(src).toMatch(/listThinkingJobs\b[\s\S]*from '@\/lib\/kairos\/thinking\/queue'/)
      expect(src).not.toMatch(/\blistJobs\b/)
    }
  })
})
