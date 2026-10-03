import type { KairosPrediction, KairosPredictionsState } from '@/lib/data/validators/kairos-predictions'
import type { PromiseDoneEvent, PromiseTaskRow } from '@/lib/data/kairos-promises'

// Shared fixtures for the prediction tests (no mocks here).

export const USER = 'user-1'
export const PROJECT = '11111111-1111-4111-8111-111111111111'
export const TASK = '22222222-2222-4222-8222-222222222222'
export const OTHER_TASK = '44444444-4444-4444-8444-444444444444'
export const EVENT = '33333333-3333-4333-8333-333333333333'
export const BASIS = 'aaaaaaaa-0000-4000-8000-000000000001'
// 2026-10-01 06:00 London (BST).
export const NOW = new Date('2026-10-01T05:00:00.000Z')

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function prediction(seq: number, over: Partial<KairosPrediction> = {}): KairosPrediction {
  return {
    id: uuid(seq),
    seq,
    claim: `The release ${seq} ships to beta users by the due date`,
    probability: 0.8,
    dueDate: '2026-10-05',
    topic: 'delivery',
    dominionId: null,
    basisIds: [],
    check: { kind: 'owner_verdict' },
    source: { kind: 'weekly_review', jobId: `old-job-${seq}` },
    createdAt: '2026-09-28T05:00:00.000Z',
    status: 'open',
    ...over,
  }
}

export const cardCheck = (expect: 'done' | 'not_done' = 'done', taskId = TASK) =>
  ({ kind: 'card_by' as const, projectId: PROJECT, taskId, expect })

export function state(open: KairosPrediction[] = [], closed: KairosPrediction[] = []): KairosPredictionsState {
  return { v: 1, nextSeq: Math.max(0, ...open.map((p) => p.seq), ...closed.map((p) => p.seq)) + 1, open, closed }
}

export function task(over: Partial<PromiseTaskRow> = {}): PromiseTaskRow {
  return { id: TASK, projectId: PROJECT, status: 'todo', completedAt: null, archivedAt: null, columnName: 'In progress', ...over }
}

export function event(at: string, actorType: 'user' | 'agent' = 'user', over: Partial<PromiseDoneEvent> = {}): PromiseDoneEvent {
  return { id: EVENT, entityId: TASK, projectId: PROJECT, actorId: 'actor', actorType, createdAt: new Date(at), ...over }
}
