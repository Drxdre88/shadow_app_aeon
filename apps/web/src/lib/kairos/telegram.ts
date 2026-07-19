// Kairos in the gram — thin client over the Telegram Bot API (fetch only,
// no dependencies). Used by the /kairos/speak fan-out and the webhook.
// Bot API contract (core.telegram.org/bots/api): sendMessage text is
// 1-4096 chars; callback_data is 1-64 bytes; MarkdownV2 requires escaping
// _ * [ ] ( ) ~ ` > # + - = | { } . ! (and backslash itself).
//
// HTML parse_mode supports b/i/u/s, code/pre, links, tg-spoiler, and
// blockquote/blockquote-expandable. The compose markdown mirrors that set:
// **bold**, *italic*, `code`, ~~strike~~, ||spoiler||, `>` quote lines, and
// `>>!` collapsed-quote lines (Bot API's <blockquote expandable>).

export const TELEGRAM_MESSAGE_LIMIT = 4096

// Pre-render split ceiling for HTML sends: headroom for the tags and
// &amp;-style entities the renderer adds on top of the source markdown.
export const TELEGRAM_HTML_SPLIT_LIMIT = 3500

export type InlineKeyboardButton = {
  text: string
  url?: string
  callback_data?: string
}

export function telegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_OPERATOR_CHAT_ID)
}

export function escapeMarkdownV2(text: string): string {
  return text.replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, (ch) => `\\${ch}`)
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Render the markdown the chat model writes into Telegram HTML (parse_mode
// 'HTML' understands only a flat tag set: b/i/s/code/pre/a/tg-spoiler/
// blockquote). Headings become bold lines, bullets become •, unsupported
// structure degrades to plain text. Split-on-capture keeps code contents
// out of the styling passes without placeholder tokens (odd split indices
// are always code).
export function renderTelegramHtml(md: string): string {
  return md
    .split(/```[a-zA-Z0-9+-]*\n?([\s\S]*?)```/g)
    .map((part, i) => (i % 2 === 1
      ? `<pre>${escapeHtml(part.replace(/\n$/, ''))}</pre>`
      : renderTextSegment(part)))
    .join('')
}

// Inline styling shared by plain text lines and blockquote content: split on
// code spans first (never restyled), then apply the remaining inline marks
// to the non-code parts.
function styleInline(text: string): string {
  return text
    .split(/`([^`\n]+)`/g)
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${escapeHtml(part)}</code>`
      let t = escapeHtml(part)
      t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
      t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      t = t.replace(/__([^_\n]+)__/g, '<b>$1</b>')
      t = t.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
      t = t.replace(/\|\|([^|\n]+)\|\|/g, '<span class="tg-spoiler">$1</span>')
      t = t.replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,!?:;])/gm, '$1<i>$2</i>')
      t = t.replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,!?:;])/gm, '$1<i>$2</i>')
      return t
    })
    .join('')
}

// Groups lines into text runs and quote runs, then renders each run through
// styleInline. A quote run is any maximal sequence of consecutive lines
// starting with `>` or `>>!`. Telegram blockquotes cannot nest, so a plain
// `>` line inside a run that also contains a `>>!` line is flattened into
// that same <blockquote expandable> rather than emitting a nested tag — the
// run's expandable-ness is "sticky" (once any line in the run is `>>!`, the
// whole run renders collapsed).
function renderTextSegment(segment: string): string {
  let s = segment.replace(/^#{1,6}\s+(.+)$/gm, '**$1**')
  s = s.replace(/^(\s*)[-*]\s+/gm, '$1• ')

  const output: string[] = []
  let textBuffer: string[] = []
  let quoteBuffer: string[] = []
  let quoteExpandable = false

  const flushText = () => {
    if (!textBuffer.length) return
    output.push(styleInline(textBuffer.join('\n')))
    textBuffer = []
  }
  const flushQuote = () => {
    if (!quoteBuffer.length) return
    const tag = quoteExpandable ? '<blockquote expandable>' : '<blockquote>'
    output.push(`${tag}${styleInline(quoteBuffer.join('\n'))}</blockquote>`)
    quoteBuffer = []
    quoteExpandable = false
  }

  for (const line of s.split('\n')) {
    const expandable = line.match(/^>>!\s?(.*)$/)
    const quote = expandable ? null : line.match(/^>\s?(.*)$/)
    if (expandable || quote) {
      flushText()
      if (expandable) quoteExpandable = true
      quoteBuffer.push((expandable ?? quote)![1])
    } else {
      flushQuote()
      textBuffer.push(line)
    }
  }
  flushText()
  flushQuote()

  return output.join('\n')
}

// Strips the delivery-critical markers from a plain-text fallback send
// (Telegram 400 on the HTML body) while keeping their content — the HTML
// tags never applied, so leaving raw `~~`/`||`/`>>!` in the wire text would
// just read as bot noise.
export function stripTelegramFallbackMarkers(text: string): string {
  return text
    .replace(/^>>!\s?/gm, '')
    .replace(/~~/g, '')
    .replace(/\|\|/g, '')
}

// Char ranges of maximal quote-line runs (any line starting with `>`,
// covering both plain `>` and `>>!`) in raw compose markdown. [start, end)
// where start is the offset of the run's first line and end is the offset
// right after its last line's trailing newline (or text.length).
function findBlockquoteRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let pos = 0
  let runStart = -1
  while (pos <= text.length) {
    const newline = text.indexOf('\n', pos)
    const lineEnd = newline === -1 ? text.length : newline
    const isQuoteLine = text[pos] === '>'
    if (isQuoteLine && runStart === -1) runStart = pos
    if (!isQuoteLine && runStart !== -1) {
      ranges.push([runStart, pos])
      runStart = -1
    }
    if (newline === -1) {
      if (runStart !== -1) ranges.push([runStart, text.length])
      break
    }
    pos = lineEnd + 1
  }
  return ranges
}

// Split long text into <=limit chunks, preferring newline boundaries and
// never cutting immediately after a backslash (would orphan an escape
// pair) or inside a blockquote run — a cut landing inside one is pulled
// back to just before the block (or, if the block starts at offset 0,
// pushed to just after it, so a chunk always makes forward progress).
export function splitTelegramMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let rest = text
  while (rest.length > limit) {
    const window = rest.slice(0, limit)
    const newline = window.lastIndexOf('\n')
    let cut = newline > limit / 2 ? newline : limit
    while (cut > 1 && rest[cut - 1] === '\\') cut--

    // Ranges are [start-of-first-line, start-of-line-after-run); the rest of
    // this function's convention is "cut = index of the separating newline"
    // (excluded from the pushed chunk, stripped off the remainder), so both
    // fallbacks step back one char onto that newline rather than the line start.
    const hit = findBlockquoteRanges(rest).find(([start, end]) => cut > start && cut < end)
    if (hit) {
      const [start, end] = hit
      if (start > 1) {
        cut = start - 1
      } else if (end - 1 <= limit) {
        // Run starts the chunk — push past it so the loop makes progress.
        cut = end < rest.length ? end - 1 : end
      }
      // else: the run alone exceeds the limit. Keep the naive newline cut so
      // no chunk can exceed the limit — the run splits into two valid
      // blockquote runs (each line keeps its own >/>>! prefix).
    }

    chunks.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

type TelegramEnvelope = { ok?: boolean; description?: string; result?: unknown }

async function callTelegram(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured')

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as TelegramEnvelope | null
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram ${method} failed (${res.status}): ${body?.description ?? 'no response body'}`)
  }
  return body.result
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  opts: { inlineKeyboard?: InlineKeyboardButton[][]; parseMode?: 'MarkdownV2' | 'HTML' } = {},
): Promise<{ messageId: number }> {
  const result = (await callTelegram('sendMessage', {
    chat_id: chatId,
    text,
    ...(opts.parseMode ? { parse_mode: opts.parseMode } : {}),
    ...(opts.inlineKeyboard ? { reply_markup: { inline_keyboard: opts.inlineKeyboard } } : {}),
  })) as { message_id: number }
  return { messageId: result.message_id }
}

export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  await callTelegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  })
}

export async function editMessageText(
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<void> {
  await callTelegram('editMessageText', { chat_id: chatId, message_id: messageId, text })
}

function aeonKairosUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || process.env.NEXTAUTH_URL
  if (!base) return null
  return `${base.replace(/\/$/, '')}/kairos`
}

// /kairos/speak fan-out. Returns true only when the Telegram delivery
// actually happened; false when the channel isn't configured. Throws on
// Telegram API failure — the speak route catches and degrades.
export async function sendKairosSpeak(input: {
  memoryId: string
  title: string
  message: string
  kind: 'notify' | 'question'
}): Promise<boolean> {
  const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('[kairos-telegram] TELEGRAM_BOT_TOKEN / TELEGRAM_OPERATOR_CHAT_ID unset — skipping fan-out')
    return false
  }

  const url = aeonKairosUrl()
  const inlineKeyboard: InlineKeyboardButton[][] =
    input.kind === 'question'
      ? url ? [[{ text: 'Open in Aeon', url }]] : []
      : [[{ text: 'Dismiss', callback_data: `dismiss:${input.memoryId}` }]]

  // Split the raw markdown first — HTML tags must never straddle a chunk
  // boundary — then render each chunk. The lower limit leaves headroom for
  // tag/entity expansion against the 4096 post-render ceiling.
  const chunks = splitTelegramMessage(input.message, TELEGRAM_HTML_SPLIT_LIMIT)
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1
    const keyboard = isLast && inlineKeyboard.length ? { inlineKeyboard } : {}
    const html = (i === 0 ? `<b>${escapeHtml(input.title)}</b>\n\n` : '') + renderTelegramHtml(chunks[i])
    try {
      await sendMessage(chatId, html, { parseMode: 'HTML', ...keyboard })
    } catch {
      // A formatting rejection must not kill delivery — degrade to plain
      // text (stripping the markers the HTML tags never applied); a
      // genuine API failure re-throws from the plain send.
      const plain = stripTelegramFallbackMarkers(chunks[i])
      await sendMessage(chatId, (i === 0 ? `${input.title}\n\n` : '') + plain, keyboard)
    }
  }
  return true
}
