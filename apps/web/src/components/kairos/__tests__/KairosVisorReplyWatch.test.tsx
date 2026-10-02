/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/lib/actions/kairos-chat', () => ({
  listKairosThreads: vi.fn(),
  loadKairosThread: vi.fn(),
  sendKairosMessage: vi.fn(),
  startKairosThread: vi.fn(),
}))
vi.mock('@/components/ui/KairosMarkdown', () => ({
  KairosMarkdown: ({ markdown }: { markdown: string }) => <span>{markdown}</span>,
}))

import { listKairosThreads, loadKairosThread, sendKairosMessage } from '@/lib/actions/kairos-chat'
import { useKairosVisorStore } from '@/stores/kairosVisorStore'
import { KairosVisor } from '../KairosVisor'
import { KairosMessageStream } from '../KairosMessageStream'
import { hasReplyAfter, REPLY_POLL_MS, REPLY_WAIT_MS } from '../KairosVisorReplyWatch'

const THREAD = 'a0000000-0000-4000-8000-000000000001'

type Role = 'user' | 'assistant'
function msg(seq: number, role: Role, content: string) {
  return {
    id: `m${seq}`, threadId: THREAD, seq, role, content,
    citations: [], retrieval: null, model: null, createdAt: new Date(),
  }
}
function loaded(messages: ReturnType<typeof msg>[]) {
  return {
    thread: {
      id: THREAD, dominionId: null, dominionName: null, title: 'Hydra', status: 'running',
      createdAt: new Date(), lastMessageAt: null, messageCount: messages.length,
    },
    messages,
  }
}

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.mocked(listKairosThreads).mockResolvedValue([])
  useKairosVisorStore.setState({ isOpen: true, activeThreadId: THREAD })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  useKairosVisorStore.setState({ isOpen: false, activeThreadId: null })
})

describe('hasReplyAfter', () => {
  it('only an assistant message after the awaited turn counts', () => {
    expect(hasReplyAfter([msg(1, 'user', 'q'), msg(2, 'assistant', 'old')], 3)).toBe(false)
    expect(hasReplyAfter([msg(3, 'user', 'q'), msg(4, 'user', 'again')], 3)).toBe(false)
    expect(hasReplyAfter([msg(3, 'user', 'q'), msg(4, 'assistant', 'a')], 3)).toBe(true)
  })
})

describe('KairosMessageStream pending bubble', () => {
  it('renders nothing extra without a reply state, the thinking bubble, or the check-back note', () => {
    const ref = { current: null }
    const { rerender } = render(<KairosMessageStream messages={[msg(1, 'user', 'q')]} scrollRef={ref} />)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<KairosMessageStream messages={[msg(1, 'user', 'q')]} scrollRef={ref} replyState="thinking" />)
    expect(screen.getByRole('status').textContent).toContain('Kairos is thinking…')
    rerender(<KairosMessageStream messages={[msg(1, 'user', 'q')]} scrollRef={ref} replyState="stale" />)
    expect(screen.getByRole('status').textContent).toMatch(/Still thinking — check back/)
  })
})

describe('KairosVisor — Max-plan reply polling', () => {
  async function sendPending() {
    vi.mocked(sendKairosMessage).mockResolvedValue({ ok: true, pending: true, threadId: THREAD, userSeq: 3 })
    render(<KairosVisor />)
    await screen.findByText('earlier answer')
    const box = screen.getByPlaceholderText(/Reply\./)
    fireEvent.change(box, { target: { value: 'status of hydra?' } })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    await screen.findByText('Kairos is thinking…')
    return box as HTMLTextAreaElement
  }

  it('shows the thinking bubble, keeps the composer usable, polls, and swaps in the reply', async () => {
    const before = [msg(1, 'user', 'earlier'), msg(2, 'assistant', 'earlier answer')]
    const sent = [...before, msg(3, 'user', 'status of hydra?')]
    vi.mocked(loadKairosThread)
      .mockResolvedValueOnce(loaded(before))
      .mockResolvedValue(loaded(sent))

    const box = await sendPending()
    expect(sendKairosMessage).toHaveBeenCalledWith({ threadId: THREAD, body: 'status of hydra?' })
    expect(box.disabled).toBe(false)
    fireEvent.change(box, { target: { value: 'typing while he thinks' } })
    expect(box.value).toBe('typing while he thinks')

    const callsBeforePoll = vi.mocked(loadKairosThread).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(REPLY_POLL_MS) })
    expect(vi.mocked(loadKairosThread).mock.calls.length).toBe(callsBeforePoll + 1)
    expect(screen.getByText('Kairos is thinking…')).toBeTruthy()

    vi.mocked(loadKairosThread).mockResolvedValue(loaded([...sent, msg(4, 'assistant', 'Hydra is green.')]))
    await act(async () => { await vi.advanceTimersByTimeAsync(REPLY_POLL_MS) })
    await flush()

    expect(await screen.findByText('Hydra is green.')).toBeTruthy()
    expect(screen.queryByText('Kairos is thinking…')).toBeNull()

    const callsAfterReply = vi.mocked(loadKairosThread).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(REPLY_POLL_MS * 3) })
    expect(vi.mocked(loadKairosThread).mock.calls.length).toBe(callsAfterReply)
  })

  it('after ~3 minutes without a reply it stops polling and says to check back', async () => {
    const before = [msg(1, 'user', 'earlier'), msg(2, 'assistant', 'earlier answer')]
    vi.mocked(loadKairosThread)
      .mockResolvedValueOnce(loaded(before))
      .mockResolvedValue(loaded([...before, msg(3, 'user', 'status of hydra?')]))

    await sendPending()
    await act(async () => { await vi.advanceTimersByTimeAsync(REPLY_WAIT_MS + REPLY_POLL_MS) })

    expect(await screen.findByText(/Still thinking — check back/)).toBeTruthy()
    const calls = vi.mocked(loadKairosThread).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(REPLY_POLL_MS * 5) })
    expect(vi.mocked(loadKairosThread).mock.calls.length).toBe(calls)
  })
})
