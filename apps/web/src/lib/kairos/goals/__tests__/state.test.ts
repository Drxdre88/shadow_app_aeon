import { describe, expect, it } from 'vitest'
import {
  GOAL_ACTOR_KINDS,
  GOAL_EVENTS,
  GOAL_STATES,
  TERMINAL_GOAL_STATES,
  transitionGoal,
  type GoalActorKind,
  type GoalEvent,
  type GoalState,
} from '../state'

const op = { kind: 'operator' } as const
const sys = { kind: 'system' } as const
const kairos = { kind: 'kairos' } as const
const agent = { kind: 'agent', via: 'mcp' } as const

describe('transitionGoal — legal edges', () => {
  it.each([
    [null, 'propose', kairos, 'proposed'],
    ['proposed', 'approve', op, 'active'],
    ['proposed', 'veto', op, 'vetoed'],
    ['proposed', 'expire', sys, 'expired'],
    ['active', 'done', op, 'done'],
    ['active', 'fail', op, 'failed'],
    ['active', 'abandon', op, 'abandoned'],
    ['active', 'timeout', sys, 'failed'],
  ] as const)('%s --%s--> %s', (from, event, actor, to) => {
    expect(transitionGoal(from, event, actor)).toEqual({ ok: true, from, to })
  })
})

describe('transitionGoal — refusals', () => {
  it('an agent can do nothing, in any state', () => {
    for (const state of [null, ...GOAL_STATES]) {
      for (const event of GOAL_EVENTS) {
        expect(transitionGoal(state, event, agent)).toEqual({ ok: false, reason: 'forbidden_actor' })
      }
    }
  })

  it('kairos may only propose; the system only expires and times out; the operator never proposes', () => {
    const allowed: Record<GoalActorKind, readonly GoalEvent[]> = {
      kairos: ['propose'],
      system: ['expire', 'timeout'],
      operator: ['approve', 'veto', 'done', 'fail', 'abandon'],
      agent: [],
    }
    for (const kind of GOAL_ACTOR_KINDS) {
      for (const event of GOAL_EVENTS) {
        const res = transitionGoal('proposed', event, { kind })
        if (!allowed[kind].includes(event)) expect(res, `${kind} ${event}`).toEqual({ ok: false, reason: 'forbidden_actor' })
      }
    }
  })

  it('terminal states absorb every operator/system event as already_resolved (expired → expired on decide)', () => {
    for (const state of TERMINAL_GOAL_STATES) {
      for (const [event, actor] of [['approve', op], ['veto', op], ['done', op], ['fail', op], ['abandon', op], ['expire', sys], ['timeout', sys]] as const) {
        const want = state === 'expired' && (event === 'approve' || event === 'veto') ? 'expired' : 'already_resolved'
        expect(transitionGoal(state, event, actor), `${state} ${event}`).toEqual({ ok: false, reason: want })
      }
    }
  })

  it('a second approve (repeat tap) is already_resolved, not a second activation', () => {
    expect(transitionGoal('active', 'approve', op)).toEqual({ ok: false, reason: 'already_resolved' })
    expect(transitionGoal('active', 'veto', op)).toEqual({ ok: false, reason: 'already_resolved' })
    expect(transitionGoal('active', 'expire', sys)).toEqual({ ok: false, reason: 'already_resolved' })
  })

  it('closing a goal that was never approved is not_active', () => {
    for (const event of ['done', 'fail', 'abandon'] as const) {
      expect(transitionGoal('proposed', event, op)).toEqual({ ok: false, reason: 'not_active' })
    }
    expect(transitionGoal('proposed', 'timeout', sys)).toEqual({ ok: false, reason: 'not_active' })
  })

  it('every (state, event, rightful actor) pair has a defined outcome', () => {
    const rightful: Record<GoalEvent, GoalActorKind> = {
      propose: 'kairos', approve: 'operator', veto: 'operator', expire: 'system',
      done: 'operator', fail: 'operator', abandon: 'operator', timeout: 'system',
    }
    for (const state of [null, ...GOAL_STATES] as Array<GoalState | null>) {
      for (const event of GOAL_EVENTS) {
        const res = transitionGoal(state, event, { kind: rightful[event] })
        expect(res.ok || ['already_resolved', 'expired', 'not_active', 'invalid_event'].includes(res.reason)).toBe(true)
      }
    }
  })
})
