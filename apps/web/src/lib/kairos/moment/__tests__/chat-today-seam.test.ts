import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// chat-today × moment seam: owner-turn and reply hooks are detached through
// after() only when a lane implements them; empty lanes schedule nothing new.

const lanes = vi.hoisted(() => ({ rapport: {} as Record<string, unknown> }))
const afterTasks = vi.hoisted(() => [] as Array<() => unknown>)
vi.mock('@/lib/kairos/moment/lanes/rapport', () => ({ rapportLane: lanes.rapport }))
vi.mock('next/server', () => ({ after: vi.fn((task: () => unknown) => { afterTasks.push(task) }) }))
vi.mock('@/lib/kairos/today', () => ({ loadTodayDigest: vi.fn(), recordTodayAfter: vi.fn() }))
vi.mock('@/lib/kairos/today-render', () => ({ renderTodaySection: vi.fn() }))
vi.mock('@/lib/kairos/surprise/owner-correction', () => ({ scheduleChatCorrectionCheck: vi.fn() }))

import { after } from 'next/server'
import { recordTodayAfter } from '@/lib/kairos/today'
import { scheduleChatCorrectionCheck } from '@/lib/kairos/surprise/owner-correction'
import { recordChatOwnerTurn, recordChatReply } from '../../chat-today'

beforeEach(() => {
  vi.clearAllMocks()
  afterTasks.length = 0
})

afterEach(() => {
  for (const key of Object.keys(lanes.rapport)) delete lanes.rapport[key]
})

describe('chat-today moment hooks', () => {
  it('empty lanes: the owner turn and reply record exactly as before, nothing detached', async () => {
    recordChatOwnerTurn('u', 't', 3, 'ugh', 'telegram')
    await recordChatReply('u', 't', 4, 'reply', 'telegram')
    expect(recordTodayAfter).toHaveBeenCalledTimes(2)
    expect(scheduleChatCorrectionCheck).toHaveBeenCalledWith('u', 't', 3, 'ugh')
    expect(after).not.toHaveBeenCalled()
  })

  it('a lane ownerTurn hook gets every owner turn, detached', async () => {
    const ownerTurn = vi.fn()
    lanes.rapport.ownerTurn = ownerTurn
    recordChatOwnerTurn('u', 't', 3, 'ugh', 'telegram')
    expect(after).toHaveBeenCalledOnce()
    await Promise.all(afterTasks.map((task) => task()))
    expect(ownerTurn).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u', threadId: 't', seq: 3, body: 'ugh', channel: 'telegram', at: expect.any(Date) }))
  })

  it('a lane reply hook gets every persisted reply; a throw never escapes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    lanes.rapport.reply = vi.fn(() => { throw new Error('boom') })
    await expect(recordChatReply('u', 't', 4, 'reply', 'web')).resolves.toBeUndefined()
    await Promise.all(afterTasks.map((task) => task()))
    expect(lanes.rapport.reply).toHaveBeenCalledWith(expect.objectContaining({ seq: 4, content: 'reply', channel: 'web' }))
  })

  it('the today entry never carries a stored trust footer (stripped whatever the flags)', async () => {
    delete process.env.KAIROS_TRUST
    await recordChatReply('u', 't', 4, 'Ship it Friday.\n\n⚖️ On Swarm: you can lean on me here.', 'web')
    const entry = vi.mocked(recordTodayAfter).mock.calls[0][1] as { text: string }
    expect(entry.text).toBe('Ship it Friday.')
  })
})
