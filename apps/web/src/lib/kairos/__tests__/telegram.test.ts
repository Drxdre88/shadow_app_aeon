import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  escapeMarkdownV2,
  sendKairosSpeak,
  sendMessage,
  splitTelegramMessage,
  TELEGRAM_MESSAGE_LIMIT,
} from '../telegram'

function fetchOk(result: unknown = { message_id: 7 }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, result }),
  })
}

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'bot-token'
  process.env.TELEGRAM_OPERATOR_CHAT_ID = '12345'
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID
  delete process.env.NEXT_PUBLIC_APP_URL
})

describe('escapeMarkdownV2', () => {
  it('escapes every reserved MarkdownV2 character', () => {
    const reserved = '_*[]()~`>#+-=|{}.!'
    expect(escapeMarkdownV2(reserved)).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!')
    expect(escapeMarkdownV2('back\\slash')).toBe('back\\\\slash')
    expect(escapeMarkdownV2('plain words 123')).toBe('plain words 123')
  })
})

describe('splitTelegramMessage', () => {
  it('passes short messages through untouched', () => {
    expect(splitTelegramMessage('hello')).toEqual(['hello'])
  })

  it('splits long text into chunks within the 4096 limit', () => {
    const line = 'x'.repeat(100)
    const text = Array.from({ length: 60 }, () => line).join('\n')
    const chunks = splitTelegramMessage(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT)
    expect(chunks.join('\n')).toBe(text)
  })

  it('never cuts immediately after a backslash', () => {
    const text = `${'a'.repeat(TELEGRAM_MESSAGE_LIMIT - 1)}\\.tail`
    const chunks = splitTelegramMessage(text)
    for (const chunk of chunks) expect(chunk.endsWith('\\')).toBe(false)
  })
})

describe('sendMessage', () => {
  it('POSTs to the Bot API with keyboard and parse mode', async () => {
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const out = await sendMessage('12345', 'hi', {
      parseMode: 'MarkdownV2',
      inlineKeyboard: [[{ text: 'Dismiss', callback_data: 'dismiss:m1' }]],
    })

    expect(out).toEqual({ messageId: 7 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/botbot-token/sendMessage')
    expect(JSON.parse(init.body)).toEqual({
      chat_id: '12345',
      text: 'hi',
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: [[{ text: 'Dismiss', callback_data: 'dismiss:m1' }]] },
    })
  })

  it('throws when the Bot API reports failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, description: 'Bad Request: chat not found' }),
    }))

    await expect(sendMessage('12345', 'hi')).rejects.toThrow('chat not found')
  })
})

describe('sendKairosSpeak', () => {
  it('returns false without calling fetch when the channel is unconfigured', async () => {
    delete process.env.TELEGRAM_OPERATOR_CHAT_ID
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendKairosSpeak({ memoryId: 'm1', title: 't', message: 'm', kind: 'notify' }))
      .resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a MarkdownV2 message with a Dismiss button for notify', async () => {
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendKairosSpeak({ memoryId: 'm1', title: 'Heads up!', message: 'A thing.', kind: 'notify' }))
      .resolves.toBe(true)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toBe('*Heads up\\!*\n\nA thing\\.')
    expect(body.parse_mode).toBe('MarkdownV2')
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: 'Dismiss', callback_data: 'dismiss:m1' }]])
  })

  it('uses an Open-in-Aeon URL button for questions when a base URL is set', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://aeon.example/'
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    await sendKairosSpeak({ memoryId: 'm1', title: 'Q', message: 'What now?', kind: 'question' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: 'Open in Aeon', url: 'https://aeon.example/kairos' }]])
  })

  it('attaches the keyboard only to the last chunk of a long message', async () => {
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    const message = Array.from({ length: 80 }, (_, i) => `line ${i} ${'x'.repeat(90)}`).join('\n')
    await sendKairosSpeak({ memoryId: 'm1', title: 't', message, kind: 'notify' })

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))
    for (const body of bodies.slice(0, -1)) expect(body.reply_markup).toBeUndefined()
    expect(bodies[bodies.length - 1].reply_markup).toBeDefined()
  })
})
