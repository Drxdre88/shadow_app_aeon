import { captureMemory } from '@/lib/data/memories'
import type { MemoryType } from '@/lib/data/validators'

// ─────────────────────────────────────────────────────────────────────────
// Kairos Phase 2 (A3 / A4) — auto-capture helpers.
//
// Called fire-and-forget from board + project server actions after the
// underlying mutation succeeds. Every Aeon mutation produces a memory
// belonging to the actor, so the Briefer has material to work with.
//
// Failures must never break the parent mutation — every caller should
// .catch(() => {}) the returned promise.
// ─────────────────────────────────────────────────────────────────────────

type BoardAction = 'created' | 'updated' | 'moved' | 'completed' | 'deleted'

const TITLE_MAX = 200

function truncate(s: string, max = TITLE_MAX): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

export interface BoardEventInput {
  userId: string
  projectId: string
  projectName?: string | null
  taskId: string
  taskName?: string | null
  action: BoardAction
  metadata?: Record<string, unknown>
}

export async function captureBoardEvent(input: BoardEventInput) {
  const name = input.taskName?.trim() || '(untitled task)'
  const type: MemoryType = input.action === 'completed' ? 'achievement' : 'snapshot'

  const lines: string[] = [`Task **${name}** ${input.action}.`]
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    lines.push('')
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v === null || v === undefined) continue
      lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }

  await captureMemory(input.userId, {
    title: truncate(`${input.action} · ${name}`),
    bodyMd: lines.join('\n'),
    type,
    source: 'system',
    projectId: input.projectId,
    sourceMetadata: {
      kind: 'board_event',
      action: input.action,
      taskId: input.taskId,
      ...input.metadata,
    },
  })
}

export interface ProjectEventInput {
  userId: string
  projectId: string
  projectName?: string | null
  action: 'created' | 'updated'
  metadata?: Record<string, unknown>
}

export async function captureProjectEvent(input: ProjectEventInput) {
  const name = input.projectName?.trim() || '(untitled project)'

  const lines: string[] = [`Project **${name}** ${input.action}.`]
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    lines.push('')
    for (const [k, v] of Object.entries(input.metadata)) {
      if (v === null || v === undefined) continue
      lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    }
  }

  await captureMemory(input.userId, {
    title: truncate(`project ${input.action} · ${name}`),
    bodyMd: lines.join('\n'),
    type: 'snapshot',
    source: 'system',
    projectId: input.projectId,
    sourceMetadata: {
      kind: 'project_event',
      action: input.action,
    },
  })
}
