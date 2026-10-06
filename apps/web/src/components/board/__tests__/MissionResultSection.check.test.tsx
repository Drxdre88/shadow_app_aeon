/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MissionResultSection } from '../MissionResultSection'

vi.mock('@/lib/actions/hangar-autopilot', () => ({ answerAndRelaunch: vi.fn(), createFollowUpCards: vi.fn() }))
vi.mock('@/components/ui/Toast', () => ({ toast: vi.fn() }))

afterEach(cleanup)

const RESULT = { status: 'completed', summary: 'Added the export button.' }
const check = (over: Record<string, unknown> = {}) => ({
  sessionId: 's-2',
  verdict: 'partly_done',
  reasons: ['Tests are not mentioned'],
  unmet: ['Unit tests'],
  note: 'Mostly there.',
  checkedAt: '2026-10-06T20:00:00.000Z',
  mode: 'on',
  ...over,
})
const mission = (c: unknown, sessionIds = ['s-1', 's-2']) => ({ sessionIds, lastResult: RESULT, check: c })

describe("MissionResultSection — Vorath's check", () => {
  it('shows the advisory verdict with reasons and unmet items on demand', () => {
    render(<MissionResultSection result={RESULT} mission={mission(check())} />)
    expect(screen.getByText("Vorath's check:")).toBeTruthy()
    expect(screen.getByText('Partly done')).toBeTruthy()
    expect(screen.getByText('Advisory — based on what the mission reported; you decide.')).toBeTruthy()
    expect(screen.queryByText('Unit tests')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Unit tests')).toBeTruthy()
    expect(screen.getByText('Tests are not mentioned')).toBeTruthy()
    expect(screen.getByText('Mostly there.')).toBeTruthy()
  })

  it('stays hidden in observe mode', () => {
    render(<MissionResultSection result={RESULT} mission={mission(check({ mode: 'observe' }))} />)
    expect(screen.getByText('Added the export button.')).toBeTruthy()
    expect(screen.queryByText("Vorath's check:")).toBeNull()
  })

  it('hides a verdict about an older mission, a malformed one, or none', () => {
    const { rerender } = render(<MissionResultSection result={RESULT} mission={mission(check({ sessionId: 's-1' }))} />)
    expect(screen.queryByText("Vorath's check:")).toBeNull()
    rerender(<MissionResultSection result={RESULT} mission={mission(check({ verdict: 'merged' }))} />)
    expect(screen.queryByText("Vorath's check:")).toBeNull()
    rerender(<MissionResultSection result={RESULT} />)
    expect(screen.queryByText("Vorath's check:")).toBeNull()
  })
})
