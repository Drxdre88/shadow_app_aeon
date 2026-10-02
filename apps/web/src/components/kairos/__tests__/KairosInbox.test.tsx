/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/lib/actions/kairos-inbox', () => ({
  listKairosInbox: vi.fn(),
  acceptKairosInboxProposal: vi.fn(),
  dismissKairosInboxProposal: vi.fn(),
  answerKairosInboxAsk: vi.fn(),
  dismissKairosInboxAsk: vi.fn(),
}))
vi.mock('@/lib/actions/kairos-voice', () => ({
  confirmVoiceNote: vi.fn(),
  discardVoiceNote: vi.fn(),
}))
vi.mock('@/components/ui/KairosMarkdown', () => ({ KairosMarkdown: () => null }))

import {
  acceptKairosInboxProposal,
  answerKairosInboxAsk,
  dismissKairosInboxAsk,
  listKairosInbox,
} from '@/lib/actions/kairos-inbox'
import { confirmVoiceNote, discardVoiceNote } from '@/lib/actions/kairos-voice'
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

describe('KairosInbox — open questions', () => {
  const ASK_A = '33333333-3333-4333-8333-333333333333'
  const ASK_B = '44444444-4444-4444-8444-444444444444'

  beforeEach(() => {
    vi.mocked(listKairosInbox).mockResolvedValue({
      items: [
        { kind: 'ask' as const, id: ASK_A, seq: 12, title: 'Should Atlas ship this week?', createdAt: new Date() },
        { kind: 'ask' as const, id: ASK_B, seq: 14, title: 'What made Tuesday hard?', createdAt: new Date() },
      ],
    } as never)
    vi.mocked(answerKairosInboxAsk).mockResolvedValue({ reflectionId: 'r-1' })
    vi.mocked(dismissKairosInboxAsk).mockResolvedValue({ id: ASK_B })
  })

  async function openAsks() {
    render(<KairosInbox />)
    fireEvent.click(await screen.findByRole('button', { name: /Kairos inbox, 2 pending/ }))
    return screen.findByRole('dialog')
  }

  it('lists every open question with its Q number and its own answer box', async () => {
    const dialog = await openAsks()
    expect(within(dialog).getByText(/Open questions · 2/)).toBeTruthy()
    expect(within(dialog).getByText('Q12')).toBeTruthy()
    expect(within(dialog).getByText('Q14')).toBeTruthy()
    expect(within(dialog).getByRole('textbox', { name: 'Answer Q12' })).toBeTruthy()
    expect(within(dialog).getByRole('textbox', { name: 'Answer Q14' })).toBeTruthy()
  })

  it('answers the question whose box was used, not just the first', async () => {
    const dialog = await openAsks()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Answer Q14' }), { target: { value: 'The deploy broke' } })
    const card = within(dialog).getByText('What made Tuesday hard?').closest('li')!
    fireEvent.click(within(card).getByRole('button', { name: 'Send answer' }))
    await vi.waitFor(() => expect(answerKairosInboxAsk).toHaveBeenCalledWith(ASK_B, 'The deploy broke'))
  })

  it('dismisses one question through the server action', async () => {
    const dialog = await openAsks()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss Q14' }))
    await vi.waitFor(() => expect(dismissKairosInboxAsk).toHaveBeenCalledWith(ASK_B))
    expect(answerKairosInboxAsk).not.toHaveBeenCalled()
  })
})

describe('KairosInbox — voice notes', () => {
  const NOTE = '55555555-5555-4555-8555-555555555555'
  const seg = (part: number) => ({
    kind: 'proposal' as const,
    id: `seg-${part}`,
    title: `Voice note ${part}/5: Part ${part} opening.`,
    summary: `Part ${part} opening.`,
    createdAt: new Date(),
    voiceNote: { noteId: NOTE, part, of: 5 },
  })

  function voiceInbox(parts: number[]) {
    const segments = parts.map(seg)
    return {
      items: [{
        kind: 'voice_note' as const,
        id: NOTE,
        noteId: NOTE,
        parts: 5,
        pendingIds: segments.map((s) => s.id),
        segments,
        title: 'Voice note · 5 parts',
        summary: segments[0]!.summary,
        createdAt: new Date(),
      }],
    }
  }

  async function openVoice(parts: number[]) {
    vi.mocked(listKairosInbox).mockResolvedValue(voiceInbox(parts) as never)
    vi.mocked(confirmVoiceNote).mockResolvedValue({} as never)
    vi.mocked(discardVoiceNote).mockResolvedValue({} as never)
    render(<KairosInbox />)
    fireEvent.click(await screen.findByRole('button', { name: /Kairos inbox, 1 pending/ }))
    const dialog = await screen.findByRole('dialog')
    return within(dialog).getByText(/Voice note · 5 parts/).closest('li')!
  }

  it('renders ONE card with the verbatim excerpt; parts expand on demand', async () => {
    const card = await openVoice([1, 2, 3, 4, 5])
    expect(within(card).getByText('“Part 1 opening.”')).toBeTruthy()
    expect(within(card).queryByText(/waiting/)).toBeNull()
    expect(within(card).queryByText('Part 4 opening.')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Show 5 parts' }))
    for (const n of [1, 2, 3, 4, 5]) expect(within(card).getByText(`Part ${n} opening.`)).toBeTruthy()
  })

  it('shows "k of N waiting" when some parts were already handled', async () => {
    const card = await openVoice([3, 4])
    expect(within(card).getByText('2 of 5 waiting')).toBeTruthy()
  })

  it('Confirm all and Discard act on the whole note', async () => {
    const card = await openVoice([1, 2, 3, 4, 5])
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm all' }))
    await vi.waitFor(() => expect(confirmVoiceNote).toHaveBeenCalledWith(NOTE))
    await vi.waitFor(() => expect(within(card).getByRole('button', { name: 'Discard' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(within(card).getByRole('button', { name: 'Discard' }))
    await vi.waitFor(() => expect(discardVoiceNote).toHaveBeenCalledWith(NOTE))
  })
})
