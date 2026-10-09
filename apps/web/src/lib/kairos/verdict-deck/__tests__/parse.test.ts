import { describe, expect, it } from 'vitest'
import { parseReplyToAsk } from '../../ask-numbered'
import { formatDeckAck, parseDeckReply } from '../parse'

describe('a free reply to a deck with one Q is not an answer to that Q', () => {
  it('the deck footer marks it as a digest', () => {
    const deck = 'Vorath · 2026-10-11\n\n**Calm.**\n\n1. Q4 · Ship Friday?\n\nReply e.g. "1y 2n 3 skip"'
    expect(parseReplyToAsk('sounds good', deck, [4])).toEqual({ answers: [], skips: [] })
  })
})

describe('parseDeckReply', () => {
  it('reads the reply variants', () => {
    expect(parseDeckReply('1y 2n 3 skip 4 yes 5 no')).toEqual([
      { n: 1, verdict: 'yes' }, { n: 2, verdict: 'no' }, { n: 3, verdict: 'skip' }, { n: 4, verdict: 'yes' }, { n: 5, verdict: 'no' },
    ])
    expect(parseDeckReply('6 ✅ 7❌, 8: keep; 9 drop\n10 s')).toEqual([
      { n: 6, verdict: 'yes' }, { n: 7, verdict: 'no' }, { n: 8, verdict: 'yes' }, { n: 9, verdict: 'no' }, { n: 10, verdict: 'skip' },
    ])
    expect(parseDeckReply('1Y 2 NO.')).toEqual([{ n: 1, verdict: 'yes' }, { n: 2, verdict: 'no' }])
  })

  it('a repeated number keeps its first verdict', () => {
    expect(parseDeckReply('1y 1n')).toEqual([{ n: 1, verdict: 'yes' }])
  })

  it.each([
    'R3 right', 'Q12: yes', 'D3 void', 'P2 kept', 'cancel A3', 'skip Q4',
    '3', '2026', '1. fix the header', '1 yes please', '3 nope', 'yes', '', 'I have 2 now',
  ])('%j is not a deck reply', (body) => {
    expect(parseDeckReply(body)).toBeNull()
  })
})

describe('formatDeckAck', () => {
  it('one line in message order', () => {
    expect(formatDeckAck([
      { n: 1, status: 'done', word: 'kept' },
      { n: 2, status: 'done', word: 'dropped' },
      { n: 3, status: 'skipped' },
      { n: 4, status: 'unknown' },
      { n: 5, status: 'already_handled' },
    ])).toBe('✓ 1 kept · ✓ 2 dropped · 3 skipped · 4 unknown · 5 already handled')
  })
})
