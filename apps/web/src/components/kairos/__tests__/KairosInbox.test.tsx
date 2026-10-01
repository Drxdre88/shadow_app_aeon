/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/lib/actions/kairos-inbox', () => ({
  listKairosInbox: vi.fn(),
  acceptKairosInboxProposal: vi.fn(),
  dismissKairosInboxProposal: vi.fn(),
  answerKairosInboxAsk: vi.fn(),
}))
vi.mock('@/components/ui/KairosMarkdown', () => ({ KairosMarkdown: () => null }))

import { acceptKairosInboxProposal, listKairosInbox } from '@/lib/actions/kairos-inbox'
import { KairosInbox, readInboxIdea } from '../KairosInbox'

const IDEA_ID = '11111111-1111-4111-8111-111111111111'
const PLAIN_ID = '22222222-2222-4222-8222-222222222222'

function inbox() {
  return {
    items: [
      {
        kind: 'proposal' as const,
        id: IDEA_ID,
        title: 'Batch the digests',
        summary: 'summary that ideas replace',
        createdAt: new Date(),
        idea: {
          claim: 'Send one weekly digest instead of three',
          why: 'You mute two of them',
          nextStep: 'Turn off the evening digest for a week',
          survivedBecause: 'it beat 5 rivals and cites two complaints',
        },
      },
      { kind: 'proposal' as const, id: PLAIN_ID, title: 'Plain proposal', summary: 'Plain summary', createdAt: new Date() },
    ],
  }
}

async function openInbox() {
  render(<KairosInbox />)
  fireEvent.click(await screen.findByRole('button', { name: /Kairos inbox, 2 pending/ }))
  return screen.findByRole('dialog')
}

beforeEach(() => {
  vi.mocked(listKairosInbox).mockResolvedValue(inbox() as never)
  vi.mocked(acceptKairosInboxProposal).mockResolvedValue({ id: IDEA_ID })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('KairosInbox — idea proposals', () => {
  it('shows the Idea label, claim, why, next step and why it survived', async () => {
    const dialog = await openInbox()
    const card = within(dialog).getByText('Batch the digests').closest('li')!
    expect(within(card).getByText('Idea')).toBeTruthy()
    expect(within(card).getByText('Send one weekly digest instead of three')).toBeTruthy()
    expect(within(card).getByText('You mute two of them')).toBeTruthy()
    expect(within(card).getByText('Turn off the evening digest for a week')).toBeTruthy()
    expect(within(card).getByText('Survived because it beat 5 rivals and cites two complaints')).toBeTruthy()
    expect(within(card).queryByText('summary that ideas replace')).toBeNull()
  })

  it('leaves plain proposals unchanged', async () => {
    const dialog = await openInbox()
    const card = within(dialog).getByText('Plain proposal').closest('li')!
    expect(within(card).getByText('Plain summary')).toBeTruthy()
    expect(within(card).queryByText('Idea')).toBeNull()
  })

  it('accepts an idea through the existing server action', async () => {
    const dialog = await openInbox()
    const card = within(dialog).getByText('Batch the digests').closest('li')!
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }))
    await vi.waitFor(() => expect(acceptKairosInboxProposal).toHaveBeenCalledWith(IDEA_ID))
  })
})

describe('readInboxIdea', () => {
  it('needs a claim; blank optional fields become null', () => {
    expect(readInboxIdea(null)).toBeNull()
    expect(readInboxIdea({ why: 'x' })).toBeNull()
    expect(readInboxIdea({ claim: ' c ', why: '', nextStep: 3 })).toEqual({ claim: 'c', why: null, nextStep: null, survivedBecause: null })
  })
})
