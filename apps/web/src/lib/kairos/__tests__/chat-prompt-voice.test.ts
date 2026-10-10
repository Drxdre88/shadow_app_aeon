import { describe, expect, it } from 'vitest'
import { buildChatMessages, buildChatSystemPrompt, VOICE_CHAT_REGISTER } from '@/lib/kairos/chat-prompt'

const retrieval = {
  cortex: null,
  archetypes: [],
  substrate: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Note', body: 'Body', streamClass: 'reflection' }],
}

describe('chat prompt — voice register', () => {
  it('voice channel adds the spoken register and drops the markdown/Telegram format lines', () => {
    const prompt = buildChatSystemPrompt(null, { channel: 'voice', surface: 'telegram' })
    for (const line of VOICE_CHAT_REGISTER) expect(prompt).toContain(line)
    expect(prompt).toMatch(/2–3 short sentences/)
    expect(prompt).toMatch(/No markdown, lists, headings, tables, code, links or emoji/)
    expect(prompt).toMatch(/at most one question/)
    expect(prompt).toMatch(/numbers the way a person says them aloud/)
    expect(prompt).not.toContain('Markdown for replies')
    expect(prompt).not.toContain('texting the operator on Telegram')
  })

  it('without the voice channel the register is absent', () => {
    const app = buildChatSystemPrompt(null, {})
    const telegram = buildChatSystemPrompt(null, { surface: 'telegram' })
    for (const prompt of [app, telegram]) {
      expect(prompt).not.toContain(VOICE_CHAT_REGISTER[0])
    }
    expect(app).toContain('Markdown for replies')
  })

  it('voice citations are told they are removed before speaking', () => {
    const prompt = buildChatSystemPrompt(null, { channel: 'voice', retrieval })
    expect(prompt).toContain('removed before the reply is spoken')
  })

  it('buildChatMessages carries the channel into the system message', () => {
    const [system] = buildChatMessages({ dominion: null, history: [], userMessage: 'hi', channel: 'voice' })
    expect(system.role).toBe('system')
    expect(system.content).toContain(VOICE_CHAT_REGISTER[1])
  })
})
