// Goal state machine (Phase 2 initiative, Track A). Pure: no DB, no clock.
//   (none)   --propose[kairos]-->             proposed
//   proposed --approve[operator]-->           active
//   proposed --veto[operator]-->              vetoed
//   proposed --expire[system]-->              expired
//   active   --done|fail|abandon[operator]--> done | failed | abandoned
//   active   --timeout[system]-->             failed
// Terminal states absorb every event ('already_resolved'). An agent may do
// nothing; Kairos may only propose; the system only expires and times out.

export const GOAL_STATES = ['proposed', 'active', 'done', 'failed', 'abandoned', 'vetoed', 'expired'] as const
export type GoalState = (typeof GOAL_STATES)[number]

export const GOAL_EVENTS = ['propose', 'approve', 'veto', 'expire', 'done', 'fail', 'abandon', 'timeout'] as const
export type GoalEvent = (typeof GOAL_EVENTS)[number]

export const GOAL_ACTOR_KINDS = ['operator', 'system', 'kairos', 'agent'] as const
export type GoalActorKind = (typeof GOAL_ACTOR_KINDS)[number]

export interface GoalActor {
  kind: GoalActorKind
  via?: string
}

export const TERMINAL_GOAL_STATES: readonly GoalState[] = ['done', 'failed', 'abandoned', 'vetoed', 'expired']

export function isTerminalGoalState(state: GoalState): boolean {
  return TERMINAL_GOAL_STATES.includes(state)
}

export function isGoalState(v: unknown): v is GoalState {
  return typeof v === 'string' && (GOAL_STATES as readonly string[]).includes(v)
}

const EVENT_ACTOR: Record<GoalEvent, GoalActorKind> = {
  propose: 'kairos',
  approve: 'operator',
  veto: 'operator',
  expire: 'system',
  done: 'operator',
  fail: 'operator',
  abandon: 'operator',
  timeout: 'system',
}

export function goalEventActor(event: GoalEvent): GoalActorKind {
  return EVENT_ACTOR[event]
}

const EDGES: Partial<Record<GoalState | 'none', Partial<Record<GoalEvent, GoalState>>>> = {
  none: { propose: 'proposed' },
  proposed: { approve: 'active', veto: 'vetoed', expire: 'expired' },
  active: { done: 'done', fail: 'failed', abandon: 'abandoned', timeout: 'failed' },
}

export type GoalTransitionRefusal = 'forbidden_actor' | 'already_resolved' | 'expired' | 'not_active' | 'invalid_event'

export type GoalTransitionResult =
  | { ok: true; from: GoalState | null; to: GoalState }
  | { ok: false; reason: GoalTransitionRefusal }

// The actor check comes first: an agent is refused even on a settled goal.
export function transitionGoal(state: GoalState | null, event: GoalEvent, actor: GoalActor): GoalTransitionResult {
  if (EVENT_ACTOR[event] !== actor.kind) return { ok: false, reason: 'forbidden_actor' }
  const to = EDGES[state ?? 'none']?.[event]
  if (to) return { ok: true, from: state, to }
  if (state === 'expired' && (event === 'approve' || event === 'veto')) return { ok: false, reason: 'expired' }
  if (state && isTerminalGoalState(state)) return { ok: false, reason: 'already_resolved' }
  if (state === 'active' && (event === 'approve' || event === 'veto' || event === 'expire')) {
    return { ok: false, reason: 'already_resolved' }
  }
  if (state === 'proposed' && (event === 'done' || event === 'fail' || event === 'abandon' || event === 'timeout')) {
    return { ok: false, reason: 'not_active' }
  }
  return { ok: false, reason: 'invalid_event' }
}
