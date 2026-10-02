import {
  casGoalUpdate,
  countOpenGoals,
  findGoal,
  hasGoalProposedOn,
  insertGoalProposal,
  listStaleGoals,
  withGoalLock,
  type GoalRecord,
} from '@/lib/data/goals'
import {
  appendGoalHistory,
  GOAL_MEMORY_TYPE,
  GOAL_NOTE_MAX,
  GOAL_OPEN_CAP,
  GOAL_PROPOSAL_TTL_MS,
  type GoalCandidate,
  type GoalMeta,
  type GoalSeed,
} from './parse'
import {
  goalEventActor,
  transitionGoal,
  type GoalActor,
  type GoalEvent,
  type GoalState,
  type GoalTransitionRefusal,
} from './state'

// Goal transitions (Phase 2, Track A): the only writers of goal state. Each
// checks the actor and the state machine, then moves the row with a
// compare-and-set. Proposals and approvals hold the per-user goal lock and
// re-check the open-goal cap (active + pending ≤ 2) under it. Goals know
// nothing about promises: approval takes an optional onApproved callback.

export type GoalActionFailure = 'not_found' | 'already_resolved' | 'expired' | 'cap_reached' | 'forbidden_actor'
export type GoalCloseFailure = GoalActionFailure | 'not_active'

export type GoalActionResult<F extends string = GoalActionFailure> =
  | { ok: true; goal: GoalRecord }
  | { ok: false; reason: F }

export type ApproveGoalResult =
  | { ok: true; goal: GoalRecord; onApprovedError?: string }
  | { ok: false; reason: GoalActionFailure }

const DAY_MS = 86_400_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const utcDayOf = (d: Date) => d.toISOString().slice(0, 10)

function actorLabel(actor: GoalActor): string {
  return actor.via ? `${actor.kind}:${actor.via}` : actor.kind
}

function historyFor(goal: GoalRecord, event: GoalEvent, to: GoalState, actor: GoalActor, now: Date) {
  return appendGoalHistory(goal.meta.history, {
    at: now.toISOString(),
    event,
    from: goal.meta.state,
    to,
    actor: actor.kind,
    ...(actor.via ? { via: actor.via } : {}),
  })
}

const isPastExpiry = (goal: GoalRecord, now: Date) => Date.parse(goal.meta.expiresAt) <= now.getTime()

function note(text: string | null | undefined): string | null {
  const t = text?.trim()
  return t ? t.slice(0, GOAL_NOTE_MAX) : null
}

type Refusal = GoalTransitionRefusal

const toActionFailure = (r: Refusal): GoalActionFailure =>
  r === 'expired' || r === 'forbidden_actor' ? r : 'already_resolved'

const toCloseFailure = (r: Refusal): GoalCloseFailure => (r === 'invalid_event' ? 'already_resolved' : r)

// After a lost compare-and-set: say what the row became.
async function afterLostRace(userId: string, goalId: string): Promise<{ ok: false; reason: 'not_found' | 'already_resolved' | 'expired' }> {
  const now = await findGoal(userId, goalId)
  if (!now) return { ok: false, reason: 'not_found' }
  return { ok: false, reason: now.meta.state === 'expired' ? 'expired' : 'already_resolved' }
}

// ── Approve ────────────────────────────────────────────────────────────────

export interface ApproveGoalOptions {
  now?: Date
  // Runs after the approval commits (e.g. wave B creates the goal's promise).
  // A throw is reported as onApprovedError; the approval stands.
  onApproved?: (goal: GoalRecord) => Promise<void>
}

export async function approveGoal(
  userId: string,
  goalId: string,
  actor: GoalActor,
  opts: ApproveGoalOptions = {},
): Promise<ApproveGoalResult> {
  if (actor.kind !== goalEventActor('approve')) return { ok: false, reason: 'forbidden_actor' }
  if (!UUID_RE.test(goalId)) return { ok: false, reason: 'not_found' }
  const now = opts.now ?? new Date()

  const result = await withGoalLock(userId, async (tx): Promise<ApproveGoalResult> => {
    const goal = await findGoal(userId, goalId, tx)
    if (!goal) return { ok: false, reason: 'not_found' }
    const t = transitionGoal(goal.meta.state, 'approve', actor)
    if (!t.ok) return { ok: false, reason: toActionFailure(t.reason) }
    if (goal.archivedAt) return { ok: false, reason: 'already_resolved' }
    if (isPastExpiry(goal, now)) return { ok: false, reason: 'expired' }
    const open = await countOpenGoals(userId, now, tx)
    if (open.active + open.pending > GOAL_OPEN_CAP) return { ok: false, reason: 'cap_reached' }

    const moved = await casGoalUpdate(userId, goalId, 'proposed', {
      goal: {
        state: t.to,
        dueAt: new Date(now.getTime() + goal.meta.dueInDays * DAY_MS).toISOString(),
        decidedAt: now.toISOString(),
        decidedVia: actorLabel(actor),
        history: historyFor(goal, 'approve', t.to, actor, now),
      },
      status: 'accepted',
      type: GOAL_MEMORY_TYPE,
    }, now, tx)
    return moved ? { ok: true, goal: moved } : { ok: false, reason: 'already_resolved' }
  })

  if (!result.ok || !opts.onApproved) return result
  try {
    await opts.onApproved(result.goal)
    return result
  } catch (err) {
    return { ...result, onApprovedError: err instanceof Error ? err.message : String(err) }
  }
}

// ── Veto ───────────────────────────────────────────────────────────────────

export interface VetoGoalOptions {
  now?: Date
  note?: string | null
}

export async function vetoGoal(
  userId: string,
  goalId: string,
  actor: GoalActor,
  opts: VetoGoalOptions = {},
): Promise<GoalActionResult> {
  if (actor.kind !== goalEventActor('veto')) return { ok: false, reason: 'forbidden_actor' }
  if (!UUID_RE.test(goalId)) return { ok: false, reason: 'not_found' }
  const now = opts.now ?? new Date()
  const goal = await findGoal(userId, goalId)
  if (!goal) return { ok: false, reason: 'not_found' }
  const t = transitionGoal(goal.meta.state, 'veto', actor)
  if (!t.ok) return { ok: false, reason: toActionFailure(t.reason) }
  if (isPastExpiry(goal, now)) return { ok: false, reason: 'expired' }

  const moved = await casGoalUpdate(userId, goalId, 'proposed', {
    goal: {
      state: t.to,
      decidedAt: now.toISOString(),
      decidedVia: actorLabel(actor),
      vetoNote: note(opts.note),
      history: historyFor(goal, 'veto', t.to, actor, now),
    },
    status: 'dismissed',
    archive: true,
  }, now)
  return moved ? { ok: true, goal: moved } : afterLostRace(userId, goalId)
}

// ── Close (done / fail / abandon) ──────────────────────────────────────────

export type GoalCloseOutcome = 'done' | 'fail' | 'abandon'

export interface CloseGoalOptions {
  now?: Date
  note?: string | null
}

export async function closeGoal(
  userId: string,
  goalId: string,
  outcome: GoalCloseOutcome,
  actor: GoalActor,
  opts: CloseGoalOptions = {},
): Promise<GoalActionResult<GoalCloseFailure>> {
  if (actor.kind !== goalEventActor(outcome)) return { ok: false, reason: 'forbidden_actor' }
  if (!UUID_RE.test(goalId)) return { ok: false, reason: 'not_found' }
  const now = opts.now ?? new Date()
  const goal = await findGoal(userId, goalId)
  if (!goal) return { ok: false, reason: 'not_found' }
  const t = transitionGoal(goal.meta.state, outcome, actor)
  if (!t.ok) return { ok: false, reason: toCloseFailure(t.reason) }

  const moved = await casGoalUpdate(userId, goalId, 'active', {
    goal: {
      state: t.to,
      closedAt: now.toISOString(),
      closedBy: actorLabel(actor),
      closeNote: note(opts.note),
      history: historyFor(goal, outcome, t.to, actor, now),
    },
  }, now)
  return moved ? { ok: true, goal: moved } : afterLostRace(userId, goalId)
}

// ── Expiry sweep ───────────────────────────────────────────────────────────

const SYSTEM: GoalActor = { kind: 'system', via: 'goal-expiry' }

export interface ExpireStaleGoalsResult {
  expired: string[]
  timedOut: string[]
}

// Unanswered proposals expire 72h after creation (no answer = no action);
// active goals fail at dueAt + 7 days. Idempotent: a row another sweep
// already moved simply fails its compare-and-set.
export async function expireStaleGoals(userId: string, now: Date = new Date()): Promise<ExpireStaleGoalsResult> {
  const out: ExpireStaleGoalsResult = { expired: [], timedOut: [] }
  for (const goal of await listStaleGoals(userId, now)) {
    if (goal.meta.state === 'proposed') {
      const t = transitionGoal('proposed', 'expire', SYSTEM)
      if (!t.ok) continue
      const moved = await casGoalUpdate(userId, goal.id, 'proposed', {
        goal: { state: t.to, history: historyFor(goal, 'expire', t.to, SYSTEM, now) },
        status: 'expired',
        archive: true,
      }, now)
      if (moved) out.expired.push(goal.id)
    } else if (goal.meta.state === 'active') {
      const t = transitionGoal('active', 'timeout', SYSTEM)
      if (!t.ok) continue
      const moved = await casGoalUpdate(userId, goal.id, 'active', {
        goal: {
          state: t.to,
          closedAt: now.toISOString(),
          closedBy: actorLabel(SYSTEM),
          closeNote: 'timed out 7 days after its due date',
          history: historyFor(goal, 'timeout', t.to, SYSTEM, now),
        },
      }, now)
      if (moved) out.timedOut.push(goal.id)
    }
  }
  return out
}

// ── Propose (goal_propose handler only) ────────────────────────────────────

export interface ProposeGoalInput {
  candidate: GoalCandidate
  seeds: GoalSeed[]
  jobId: string | null
  answeredBy: string | null
  embedding: number[] | null
  // UTC day the job was planned for (one goal a night).
  proposedOn: string
  now: Date
}

export type ProposeGoalResult =
  | { ok: true; goal: GoalRecord }
  | { ok: false; reason: 'forbidden_actor' | 'daily_limit' | 'cap_reached' }

export function renderGoalBody(meta: Pick<GoalMeta, 'question' | 'why' | 'successCheck' | 'dueInDays'>): string {
  return [
    `**Question:** ${meta.question}`,
    '',
    `**Why:** ${meta.why}`,
    '',
    `**Done when:** ${meta.successCheck.text}`,
    '',
    `Due ${meta.dueInDays} days after you approve it. An investigation only — Kairos looks into it and reports back; it does not act.`,
  ].join('\n')
}

export function buildProposalMeta(input: ProposeGoalInput, actor: GoalActor): GoalMeta {
  const c = input.candidate
  const proposedAt = input.now.toISOString()
  return {
    v: 1,
    state: 'proposed',
    kind: 'investigation',
    question: c.question.trim(),
    why: c.why.trim(),
    successCheck: { type: 'owner_confirm', text: c.successCheck.trim() },
    dueInDays: c.dueInDays,
    dueAt: null,
    seeds: input.seeds,
    proposedOn: DAY_RE.test(input.proposedOn) ? input.proposedOn : utcDayOf(input.now),
    proposedAt,
    expiresAt: new Date(input.now.getTime() + GOAL_PROPOSAL_TTL_MS).toISOString(),
    jobId: input.jobId,
    answeredBy: input.answeredBy,
    decidedAt: null,
    decidedVia: null,
    vetoNote: null,
    closedAt: null,
    closedBy: null,
    closeNote: null,
    telegram: null,
    history: [{ at: proposedAt, event: 'propose', from: null, to: 'proposed', actor: actor.kind, ...(actor.via ? { via: actor.via } : {}) }],
  }
}

export async function proposeGoal(userId: string, actor: GoalActor, input: ProposeGoalInput): Promise<ProposeGoalResult> {
  const t = transitionGoal(null, 'propose', actor)
  if (!t.ok) return { ok: false, reason: 'forbidden_actor' }
  const meta = buildProposalMeta(input, actor)
  return withGoalLock(userId, async (tx): Promise<ProposeGoalResult> => {
    if (await hasGoalProposedOn(userId, meta.proposedOn, tx)) return { ok: false, reason: 'daily_limit' }
    const open = await countOpenGoals(userId, input.now, tx)
    if (open.active + open.pending >= GOAL_OPEN_CAP) return { ok: false, reason: 'cap_reached' }
    const title = input.candidate.title.trim()
    const id = await insertGoalProposal(userId, {
      title,
      bodyMd: renderGoalBody(meta),
      summary: meta.question,
      dominionId: input.candidate.dominionId,
      meta,
      citations: input.seeds.map((s) => s.id),
      embedding: input.embedding,
      now: input.now,
    }, tx)
    return {
      ok: true,
      goal: { id, title, type: 'inbound', dominionId: input.candidate.dominionId, archivedAt: null, createdAt: input.now, meta },
    }
  })
}
