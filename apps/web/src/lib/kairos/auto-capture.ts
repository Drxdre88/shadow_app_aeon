import { captureMemory } from '@/lib/data/memories'
import { findTaskById } from '@/lib/data/tasks'
import { findProjectSettings } from '@/lib/data/projects'
import { listChecklistForTasks } from '@/lib/data/board-feed'
import type { MemoryType } from '@/lib/data/validators'
import { parseKairosFeed, trimText } from './board-feed-render'

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
  // Feed boards get one daily/weekly page (lib/kairos/board-feed.ts) that
  // already covers moves and edits — per-event snapshot rows there are noise.
  if (input.action === 'moved' || input.action === 'updated') {
    const feed = await loadFeedMode(input.projectId)
    if (feed) return
  }

  const name = input.taskName?.trim() || '(untitled task)'
  const type: MemoryType = input.action === 'completed' ? 'achievement' : 'snapshot'

  const lines: string[] = [`Task **${name}** ${input.action}.`]
  const card = input.action === 'completed' ? await loadCardDetail(input.taskId, input.projectId) : null
  if (card) lines.push(...renderCardDetail(card))
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
      ...(card ? {
        hasNotes: card.description.length > 0,
        checklist: { done: card.done, total: card.total },
      } : {}),
      ...input.metadata,
    },
  })
}

// ─── enrichment helpers (reads only; failures degrade to the bare event) ──

const DESCRIPTION_MAX = 400
const CHECKLIST_ITEMS_MAX = 8

interface CardDetail {
  description: string
  done: number
  total: number
  items: Array<{ title: string; done: boolean }>
}

async function loadFeedMode(projectId: string) {
  try {
    return parseKairosFeed(await findProjectSettings(projectId))
  } catch {
    return null
  }
}

async function loadCardDetail(taskId: string, projectId: string): Promise<CardDetail | null> {
  try {
    const [task, checklist] = await Promise.all([
      findTaskById(taskId, projectId),
      listChecklistForTasks([taskId]),
    ])
    if (!task) return null
    const items = checklist.map((item) => ({ title: item.title, done: item.completed || item.state === 'checked' }))
    return {
      description: trimText(task.description, DESCRIPTION_MAX),
      done: items.filter((item) => item.done).length,
      total: items.length,
      items,
    }
  } catch {
    return null
  }
}

function renderCardDetail(card: CardDetail): string[] {
  const lines: string[] = []
  if (card.description) lines.push('', `Notes: ${card.description}`)
  if (card.total > 0) {
    lines.push('', `Checklist ${card.done}/${card.total}:`)
    for (const item of card.items.slice(0, CHECKLIST_ITEMS_MAX)) {
      lines.push(`- [${item.done ? 'x' : ' '}] ${trimText(item.title, 160)}`)
    }
    if (card.items.length > CHECKLIST_ITEMS_MAX) lines.push(`- …${card.items.length - CHECKLIST_ITEMS_MAX} more`)
  }
  if (!card.description && card.total === 0) lines.push('', '_Title only — no notes or checklist._')
  return lines
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
