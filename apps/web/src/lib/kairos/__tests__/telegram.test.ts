import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  escapeHtml,
  escapeMarkdownV2,
  renderTelegramHtml,
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

describe('renderTelegramHtml', () => {
  it('renders bold, italic, and inline code', () => {
    expect(renderTelegramHtml('**bold** and *soft* and `x = 1`'))
      .toBe('<b>bold</b> and <i>soft</i> and <code>x = 1</code>')
  })

  it('converts headings to bold lines and bullets to •', () => {
    expect(renderTelegramHtml('## Plan\n- first\n- second'))
      .toBe('<b>Plan</b>\n• first\n• second')
  })

  it('escapes HTML-sensitive characters outside and inside code', () => {
    expect(renderTelegramHtml('a < b & c')).toBe('a &lt; b &amp; c')
    expect(renderTelegramHtml('`<div>`')).toBe('<code>&lt;div&gt;</code>')
  })

  it('renders fenced code blocks as <pre> without styling their contents', () => {
    expect(renderTelegramHtml('```ts\nconst **x** = 1\n```'))
      .toBe('<pre>const **x** = 1</pre>')
  })

  it('renders markdown links as anchors', () => {
    expect(renderTelegramHtml('see [docs](https://x.dev/a)'))
      .toBe('see <a href="https://x.dev/a">docs</a>')
  })

  it('leaves plain text with emojis untouched', () => {
    expect(renderTelegramHtml('✅ done — nothing fancy')).toBe('✅ done — nothing fancy')
  })

  it('does not treat multiplication or file globs as italics', () => {
    expect(renderTelegramHtml('3 * 4 and src/*.ts')).toBe('3 * 4 and src/*.ts')
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

  it('sends an HTML message with a Dismiss button for notify', async () => {
    const fetchMock = fetchOk()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendKairosSpeak({ memoryId: 'm1', title: 'Heads up!', message: 'A **big** thing.', kind: 'notify' }))
      .resolves.toBe(true)

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toBe('<b>Heads up!</b>\n\nA <b>big</b> thing.')
    expect(body.parse_mode).toBe('HTML')
    expect(body.reply_markup.inline_keyboard).toEqual([[{ text: 'Dismiss', callback_data: 'dismiss:m1' }]])
  })

  it('falls back to plain text when Telegram rejects the HTML formatting', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ ok: false, description: "Bad Request: can't parse entities" }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 8 } }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendKairosSpeak({ memoryId: 'm1', title: 'T', message: 'weird **markup', kind: 'notify' }))
      .resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retry = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(retry.parse_mode).toBeUndefined()
    expect(retry.text).toBe('T\n\nweird **markup')
    expect(retry.reply_markup.inline_keyboard).toEqual([[{ text: 'Dismiss', callback_data: 'dismiss:m1' }]])
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
