import { describe, expect, it } from 'vitest'
import { telegramChatFailureText } from '../telegram'

describe('telegramChatFailureText', () => {
  it('paid backup off points at chat on Max, never at adding an API key', () => {
    const text = telegramChatFailureText('paid_backup_off')
    expect(text).toContain('chat on your Max plan')
    expect(text).toContain('Health')
    expect(text).not.toContain('add a key')
  })

  it('a genuinely missing key still asks for one', () => {
    expect(telegramChatFailureText('no_credential')).toContain('add a key in Settings')
  })
})