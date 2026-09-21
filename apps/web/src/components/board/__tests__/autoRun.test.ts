import { describe, expect, it } from 'vitest'
import { isLaunchableMission, readHangarMission, readMissionCard, readMissionResult, shouldAutoRunOnDrop, withConfirmedMissionLaunch, withRecordedMissionLaunch } from '../autoRun'
import { parseHangarConfig } from '@/lib/store/hangarUiStore'

const TRIGGER = 'col-launch'
const ON = { enabled: true, triggerColumnId: TRIGGER }

const mission = (over: Record<string, unknown> = {}) => ({
  hangar: {
    objective: 'implement',
    repo: 'arq',
    agent: 'copilot',
    instruction: 'add a hello print to the repo root',
    autoRun: true,
    ...over,
  },
})

describe('readHangarMission', () => {
  it('returns null for plain cards and malformed payloads', () => {
    expect(readHangarMission(undefined)).toBeNull()
    expect(readHangarMission({})).toBeNull()
    expect(readHangarMission({ hangar: null })).toBeNull()
    expect(readHangarMission({ hangar: 'nope' })).toBeNull()
    expect(readHangarMission({ hangar: ['nope'] })).toBeNull()
  })

  it('returns the payload for a mission card', () => {
    expect(readHangarMission(mission())?.repo).toBe('arq')
  })
})

describe('isLaunchableMission', () => {
  it('accepts a complete mission', () => {
    expect(isLaunchableMission(mission())).toBe(true)
  })

  it('rejects half-filled drafts', () => {
    expect(isLaunchableMission(mission({ repo: '' }))).toBe(false)
    expect(isLaunchableMission(mission({ repo: '   ' }))).toBe(false)
    expect(isLaunchableMission(mission({ instruction: '' }))).toBe(false)
    expect(isLaunchableMission(mission({ objective: '' }))).toBe(false)
    expect(isLaunchableMission({ hangar: {} })).toBe(false)
  })
})

describe('mission card view parsing', () => {
  it('keeps Agent mission fields separate from ordinary labels', () => {
    const parsed = readMissionCard(mission({ model: 'gpt-5.6-sol', sessionIds: ['session-1'] }))
    expect(parsed).toMatchObject({
      repo: 'arq',
      objective: 'implement',
      agent: 'copilot',
      model: 'gpt-5.6-sol',
      sessionIds: ['session-1'],
    })
  })

  it('tolerates malformed legacy result fields without inventing a status', () => {
    const parsed = readMissionResult({
      status: 'success',
      summary: 42,
      questions: ['Which branch?', null, 10],
      artifacts: 'report.md',
      tests: { status: 'green', summary: 'fine' },
      recommended_tasks: [{ title: 'Follow up', objective: 4 }, null],
    })
    expect(parsed).toEqual(expect.objectContaining({
      status: null,
      summary: null,
      questions: ['Which branch?'],
      artifacts: [],
      tests: null,
      recommendedTasks: [{ title: 'Follow up', objective: null, instruction: null }],
    }))
  })

  it('records a launch once while preserving the mission and unrelated metadata', () => {
    const launchedAt = '2026-09-21T08:30:00.000Z'
    const first = withRecordedMissionLaunch({ ...mission({ autoRun: true, sessionIds: ['older'] }), note: 'keep' }, 'current', launchedAt)
    const second = withRecordedMissionLaunch(first, 'current', launchedAt)
    expect(second.note).toBe('keep')
    expect(second.hangar).toEqual(expect.objectContaining({
      repo: 'arq',
      autoRun: false,
      lastLaunchedAt: launchedAt,
      sessionIds: ['older', 'current'],
    }))
  })

  it('patches only the confirmed task row', () => {
    const tasks = [
      { id: 'mission', metadata: mission({ sessionIds: [] }) },
      { id: 'other', metadata: { note: 'untouched' } },
    ]
    const updated = withConfirmedMissionLaunch(tasks, 'mission', 'session-1', '2026-09-21T08:30:00.000Z')
    expect(updated[0]).not.toBe(tasks[0])
    expect(updated[1]).toBe(tasks[1])
    expect(readMissionCard(updated[0].metadata)?.sessionIds).toEqual(['session-1'])
  })
})

describe('shouldAutoRunOnDrop', () => {
  it('fires when an armed mission lands in the launch column', () => {
    expect(shouldAutoRunOnDrop(ON, {
      metadata: mission(),
      fromColumnId: 'col-backlog',
      toColumnId: TRIGGER,
    })).toBe(true)
  })

  it('never fires for a plain card', () => {
    expect(shouldAutoRunOnDrop(ON, {
      metadata: { note: 'just a card' },
      fromColumnId: 'col-backlog',
      toColumnId: TRIGGER,
    })).toBe(false)
  })

  it('never fires when the card has not armed auto-run', () => {
    expect(shouldAutoRunOnDrop(ON, {
      metadata: mission({ autoRun: false }),
      fromColumnId: 'col-backlog',
      toColumnId: TRIGGER,
    })).toBe(false)
    expect(shouldAutoRunOnDrop(ON, {
      metadata: mission({ autoRun: undefined }),
      fromColumnId: 'col-backlog',
      toColumnId: TRIGGER,
    })).toBe(false)
  })

  it('never fires on a different column, or with Auto AI off, or no trigger set', () => {
    expect(shouldAutoRunOnDrop(ON, { metadata: mission(), fromColumnId: 'a', toColumnId: 'col-other' })).toBe(false)
    expect(shouldAutoRunOnDrop({ enabled: false, triggerColumnId: TRIGGER }, {
      metadata: mission(), fromColumnId: 'a', toColumnId: TRIGGER,
    })).toBe(false)
    expect(shouldAutoRunOnDrop({ enabled: true, triggerColumnId: null }, {
      metadata: mission(), fromColumnId: 'a', toColumnId: TRIGGER,
    })).toBe(false)
  })

  it('does not re-fire when reordering inside the launch column', () => {
    expect(shouldAutoRunOnDrop(ON, {
      metadata: mission(),
      fromColumnId: TRIGGER,
      toColumnId: TRIGGER,
    })).toBe(false)
  })

  it('does not fire on an unknown drop target', () => {
    expect(shouldAutoRunOnDrop(ON, { metadata: mission(), fromColumnId: 'a', toColumnId: null })).toBe(false)
  })

  // Unknown provenance used to fail OPEN: null !== triggerColumnId slipped
  // past the "came from another column" guard and launched a real agent.
  it('fails CLOSED when the drag origin is unknown', () => {
    expect(shouldAutoRunOnDrop(ON, { metadata: mission(), fromColumnId: null, toColumnId: TRIGGER })).toBe(false)
    expect(shouldAutoRunOnDrop(ON, { metadata: mission(), fromColumnId: undefined, toColumnId: TRIGGER })).toBe(false)
    expect(shouldAutoRunOnDrop(ON, { metadata: mission(), fromColumnId: '', toColumnId: TRIGGER })).toBe(false)
  })
})

describe('parseHangarConfig', () => {
  it('defaults to disabled for boards that never opted in', () => {
    expect(parseHangarConfig(null)).toEqual({ enabled: false, triggerColumnId: null })
    expect(parseHangarConfig({})).toEqual({ enabled: false, triggerColumnId: null })
    expect(parseHangarConfig({ hangar: 'garbage' })).toEqual({ enabled: false, triggerColumnId: null })
  })

  it('only treats a literal true as enabled', () => {
    expect(parseHangarConfig({ hangar: { enabled: 'yes' } }).enabled).toBe(false)
    expect(parseHangarConfig({ hangar: { enabled: 1 } }).enabled).toBe(false)
    expect(parseHangarConfig({ hangar: { enabled: true } }).enabled).toBe(true)
  })

  it('reads the trigger column when present', () => {
    expect(parseHangarConfig({ hangar: { enabled: true, triggerColumnId: TRIGGER } })).toEqual({
      enabled: true,
      triggerColumnId: TRIGGER,
    })
    expect(parseHangarConfig({ hangar: { enabled: true, triggerColumnId: 42 } }).triggerColumnId).toBeNull()
  })
})
