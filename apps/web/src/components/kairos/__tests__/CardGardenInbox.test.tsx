/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { cardGardenDecisionText } from '../CardGardenProposal'
import { classifyInboxProposal, InboxProposalItem } from '../InboxProposalItem'
import type { ProposalItem } from '../inbox-types'

const ID = '33333333-3333-4333-8333-333333333333'

function item(action: 'finish' | 'park' | 'merge' | 'kill', over: Record<string, unknown> = {}): ProposalItem {
  return {
    kind: 'proposal',
    id: ID,
    title: 'Card garden: Merge "Write docs"',
    summary: 'Same work.',
    createdAt: new Date(),
    cardGarden: {
      isoWeek: '2026-W41', taskId: 't-1', taskName: 'Write docs', projectId: 'p-1', projectName: 'Beta', columnName: 'Live', ageDays: 40,
      action, reason: 'Same work as the other card.', mergeWith: action === 'merge' ? { taskId: 't-2', name: 'Docs writing' } : null,
      parkColumn: 'Cryo', doneColumn: 'Done', expiresAt: '2026-10-13T12:00:00.000Z',
      ...over,
    },
  } as ProposalItem
}

const props = { working: false, decision: undefined, onResolveVoiceNote: vi.fn(), onResolve: vi.fn() }

afterEach(cleanup)

describe('card garden in the inbox', () => {
  it('classifies a card garden proposal after goals and card trees', () => {
    expect(classifyInboxProposal(item('kill')).kind).toBe('card_garden')
    expect(classifyInboxProposal({ ...item('kill'), cardTree: { cards: [] } } as never).kind).toBe('card_tree')
    expect(classifyInboxProposal({ ...item('kill'), cardGarden: null } as never).kind).toBe('proposal')
  })

  it('renders the card, board, action and reason, with Approve / Veto', () => {
    const onDecide = vi.fn()
    render(<ul><InboxProposalItem item={item('park')} {...props} onDecide={onDecide} /></ul>)
    expect(screen.getByText('Write docs')).toBeTruthy()
    expect(screen.getByText('Park')).toBeTruthy()
    expect(screen.getByText(/Beta · Live · untouched 40 days/)).toBeTruthy()
    expect(screen.getByText('Same work as the other card.')).toBeTruthy()
    expect(screen.getByText('Approve to move it to Cryo.')).toBeTruthy()
    fireEvent.click(screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Veto'))
    expect(onDecide.mock.calls).toEqual([[ID, 'approve'], [ID, 'veto']])
  })

  it('a merge shows its partner and links to the board instead of fusing', () => {
    render(<ul><InboxProposalItem item={item('merge')} {...props} onDecide={vi.fn()} /></ul>)
    expect(screen.getByText('Docs writing')).toBeTruthy()
    expect(screen.getByText('Open the board to fuse them').getAttribute('href')).toBe('/project/p-1')
  })

  it('explains each decision in plain words', () => {
    const approve = { ok: true as const, verdict: 'approve' as const }
    expect(cardGardenDecisionText(approve, { action: 'park', parkColumn: null, doneColumn: null })).toBe('Approved — no backlog column, nothing moved')
    expect(cardGardenDecisionText(approve, { action: 'finish', parkColumn: null, doneColumn: 'Done' })).toBe('Approved — marked done and moved to Done ✓')
    expect(cardGardenDecisionText(approve, { action: 'merge', parkColumn: null, doneColumn: null })).toBe('Approved — fuse the cards on the board')
    expect(cardGardenDecisionText({ ok: true, verdict: 'veto' }, { action: 'kill', parkColumn: null, doneColumn: null })).toBe('Vetoed — nothing changed ✓')
    expect(cardGardenDecisionText({ ok: false, reason: 'forbidden_actor' }, { action: 'kill', parkColumn: null, doneColumn: null })).toContain('no longer edit')
  })
})
