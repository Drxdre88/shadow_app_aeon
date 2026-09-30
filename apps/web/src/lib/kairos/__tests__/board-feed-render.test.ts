import { describe, expect, it } from 'vitest'
import {
  buildBoardDayPage,
  buildBoardWeekPage,
  isoWeekLabel,
  parseKairosFeed,
  type FeedCard,
} from '../board-feed-render'

function card(overrides: Partial<FeedCard> = {}): FeedCard {
  return {
    taskId: 'task-1',
    title: 'Ship board feed',
    description: null,
    checklist: { done: 0, total: 0, items: [] },
    labels: [],
    daysTaken: null,
    at: new Date('2026-09-30T12:00:00.000Z'),
    ...overrides,
  }
}

describe('parseKairosFeed', () => {
  it.each([
    [{ kairosFeed: 'daily' }, 'daily'],
    [{ kairosFeed: ' Weekly ' }, 'weekly'],
    [{ kairosFeed: 'hourly' }, null],
    [{ kairosFeed: true }, null],
    [{}, null],
    [null, null],
    ['daily', null],
    [['daily'], null],
  ])('%j → %s', (settings, expected) => {
    expect(parseKairosFeed(settings)).toBe(expected)
  })
})

describe('buildBoardDayPage', () => {
  it('returns null on a day with no finished, started or created cards', () => {
    expect(buildBoardDayPage({ projectName: 'AS Sprint', date: '2026-09-30', finished: [], started: [], created: [] })).toBeNull()
  })

  it('reads finished cards in full and lists started, created and title-only cards', () => {
    const rich = card({
      taskId: 'task-rich',
      title: 'Wire Telegram voice',
      description: `Because the phone is where I think. ${'x'.repeat(600)}`,
      checklist: {
        done: 2,
        total: 9,
        items: Array.from({ length: 9 }, (_, index) => ({ title: `step ${index + 1}`, done: index < 2 })),
      },
      labels: ['kairos', 'mobile'],
      daysTaken: 3,
      at: new Date('2026-09-30T10:00:00.000Z'),
    })
    const thinOld = card({ taskId: undefined, vaultId: 'vault-1', title: 'Fix login', at: new Date('2026-09-30T08:00:00.000Z') })
    const thinNew = card({ taskId: 'task-thin', title: 'Deploy', at: new Date('2026-09-30T20:00:00.000Z') })
    const created = card({ taskId: 'task-new', title: 'Plan Q4', at: new Date('2026-09-30T09:00:00.000Z') })

    const page = buildBoardDayPage({
      projectName: 'AS Sprint',
      date: '2026-09-30',
      finished: [rich, thinOld, thinNew],
      started: [{ taskId: 'task-live', title: 'Refactor inbox', columnName: 'Live' }],
      created: [created],
    })

    expect(page).not.toBeNull()
    expect(page!.title).toBe('2026-09-30 · AS Sprint · board day')
    const body = page!.bodyMd
    expect(body).toContain('**Finished (3)**')
    expect(body).toContain('**Wire Telegram voice** · checklist 2/9 · labels: kairos, mobile · 3d')
    expect(body).toContain('Notes: Because the phone is where I think.')
    expect(body).not.toContain('x'.repeat(450)) // description trimmed ~400
    expect(body).toContain('- [x] step 1')
    expect(body).toContain('- [ ] step 8')
    expect(body).not.toContain('step 9')
    expect(body).toContain('- Refactor inbox → Live')
    expect(body).toContain('**Created — intent (1)**')
    expect(body).toContain('**Title-only cards (3)')
    expect(body.indexOf('**Deploy**')).toBeLessThan(body.indexOf('**Wire Telegram voice**'))

    expect(page!.finished).toEqual([
      { taskId: 'task-thin', title: 'Deploy', hasNotes: false },
      { taskId: 'task-rich', title: 'Wire Telegram voice', hasNotes: true },
      { vaultId: 'vault-1', title: 'Fix login', hasNotes: false },
    ])
    // Most recent finished title-only first; created cards never become nudges.
    expect(page!.thinCards).toEqual([
      { taskId: 'task-thin', title: 'Deploy' },
      { vaultId: 'vault-1', title: 'Fix login' },
    ])
  })

  it('caps thin cards at three', () => {
    const finished = Array.from({ length: 5 }, (_, index) => card({
      taskId: `t${index}`,
      title: `Card ${index}`,
      at: new Date(Date.UTC(2026, 8, 30, index)),
    }))
    const page = buildBoardDayPage({ projectName: 'B', date: '2026-09-30', finished, started: [], created: [] })
    expect(page!.thinCards.map((c) => c.taskId)).toEqual(['t4', 't3', 't2'])
  })

  it('does not count a card with a checklist as title-only', () => {
    const page = buildBoardDayPage({
      projectName: 'B',
      date: '2026-09-30',
      finished: [card({ checklist: { done: 1, total: 1, items: [{ title: 'a', done: true }] } })],
      started: [],
      created: [],
    })
    expect(page!.thinCards).toEqual([])
    expect(page!.bodyMd).not.toContain('Title-only')
  })
})

describe('buildBoardWeekPage', () => {
  it('renders columns, the 7-day changes and cards untouched for over 30 days', () => {
    const page = buildBoardWeekPage({
      projectName: 'STP Sprint',
      isoWeek: '2026-W40',
      columns: [
        { name: 'Milestones', cards: [card({ title: 'Release 2.0', description: 'Team cut-over', checklist: { done: 1, total: 4, items: [] } })] },
        { name: 'Done', cards: [] },
      ],
      finished: [card({ title: 'Audit sign-off' })],
      created: [card({ title: 'Kick-off Q4' })],
      moved: [{ title: 'Release 2.0', columnName: 'Milestones' }],
      untouched: [{ title: 'Old epic', columnName: 'Backlog', days: 45 }],
    })

    expect(page!.title).toBe('2026-W40 · STP Sprint · board week')
    expect(page!.bodyMd).toContain('_Milestones_ (1)')
    expect(page!.bodyMd).toContain('- **Release 2.0** · checklist 1/4 — Team cut-over')
    expect(page!.bodyMd).toContain('- Finished: Audit sign-off')
    expect(page!.bodyMd).toContain('- Added: Kick-off Q4')
    expect(page!.bodyMd).toContain('- Moved: Release 2.0 → Milestones')
    expect(page!.bodyMd).toContain('- Old epic (Backlog) · 45d')
  })

  it('returns null for an empty board with no changes', () => {
    expect(buildBoardWeekPage({
      projectName: 'X', isoWeek: '2026-W40', columns: [{ name: 'Todo', cards: [] }],
      finished: [], created: [], moved: [], untouched: [],
    })).toBeNull()
  })
})

describe('isoWeekLabel', () => {
  it.each([
    ['2026-09-28T23:00:00.000Z', '2026-W40'],
    ['2026-01-01T00:00:00.000Z', '2026-W01'],
    ['2027-01-01T00:00:00.000Z', '2026-W53'],
    ['2024-12-30T00:00:00.000Z', '2025-W01'],
  ])('%s → %s', (iso, expected) => {
    expect(isoWeekLabel(new Date(iso))).toBe(expected)
  })
})
