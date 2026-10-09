import { describe, expect, it } from 'vitest'
import {
  CALLBACK_DATA_MAX_BYTES,
  ideaVerdictKeyboard,
  inboxCallbackData,
  settledIdeaKeyboard,
  tappedIdeaVerdict,
} from '../idea-verdict-keyboard'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
// The webhook's inbox callback pattern (app/api/telegram/webhook/route.ts).
const WEBHOOK_CALLBACK_RE = /^(dismiss|accept):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const bytes = (s: string) => new TextEncoder().encode(s).length

describe('idea verdict keyboard', () => {
  it('one Keep / Drop pair per idea on the existing accept: / dismiss: callbacks, each ≤64 bytes', () => {
    const keyboard = ideaVerdictKeyboard([{ id: A, title: 'Cut the PPA scope' }])
    expect(keyboard).toEqual([[
      { text: '✅ Keep', callback_data: `accept:${A}` },
      { text: '❌ Drop', callback_data: `dismiss:${A}` },
    ]])
    for (const button of keyboard.flat()) {
      expect(bytes(button.callback_data!)).toBeLessThanOrEqual(CALLBACK_DATA_MAX_BYTES)
      expect(button.callback_data).toMatch(WEBHOOK_CALLBACK_RE)
    }
  })

  it('names each idea when there are several', () => {
    const keyboard = ideaVerdictKeyboard([{ id: A, title: 'Cut the PPA scope and ship the rest later' }, { id: B, title: 'Pair on Fridays' }])
    expect(keyboard).toHaveLength(2)
    expect(keyboard[0]![0]!.text).toBe('✅ Keep · Cut the PPA scope and s…')
    expect(keyboard[1]![1]).toEqual({ text: '❌ Drop · Pair on Fridays', callback_data: `dismiss:${B}` })
  })

  it('refuses callback data over the Telegram limit', () => {
    expect(() => inboxCallbackData('dismiss', 'x'.repeat(60))).toThrow(/64 bytes/)
  })

  it('reads which verdict button was tapped from the message keyboard', () => {
    const keyboard = [...ideaVerdictKeyboard([{ id: A }]), [{ text: 'Dismiss', callback_data: `dismiss:${B}` }]]
    expect(tappedIdeaVerdict(keyboard, `accept:${A}`)).toBe('kept')
    expect(tappedIdeaVerdict(keyboard, `dismiss:${A}`)).toBe('dropped')
    expect(tappedIdeaVerdict(keyboard, `dismiss:${B}`)).toBeNull()
    expect(tappedIdeaVerdict(undefined, `accept:${A}`)).toBeNull()
  })

  it('collapses only the tapped idea into a one-line ack button', () => {
    const keyboard = ideaVerdictKeyboard([{ id: A, title: 'a' }, { id: B, title: 'b' }])
    const settled = settledIdeaKeyboard(keyboard, `dismiss:${A}`, 'dropped')
    expect(settled[0]).toEqual([{ text: '✓ dropped', callback_data: `dismiss:${A}` }])
    expect(settled[1]).toEqual(keyboard[1])
    // The collapsed button is no longer a verdict button: a re-tap is a plain (already handled) dismiss.
    expect(tappedIdeaVerdict(settled, `dismiss:${A}`)).toBeNull()
  })
})
