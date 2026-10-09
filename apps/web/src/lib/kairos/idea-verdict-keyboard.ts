import type { InlineKeyboardButton } from './telegram'

// Pure Keep / Drop buttons for idea survivors on Telegram (Wave 2 one-tap
// loop). They ride the existing inbox callbacks (accept:<id> / dismiss:<id>),
// so a tap records exactly what the inbox Accept / Dismiss records.

export const IDEA_KEEP_LABEL = '✅ Keep'
export const IDEA_DROP_LABEL = '❌ Drop'
export const CALLBACK_DATA_MAX_BYTES = 64
const BUTTON_TITLE_CHARS = 24

export type InboxCallbackAction = 'accept' | 'dismiss'
export type IdeaVerdict = 'kept' | 'dropped'

export function inboxCallbackData(action: InboxCallbackAction, memoryId: string): string {
  const data = `${action}:${memoryId}`
  if (new TextEncoder().encode(data).length > CALLBACK_DATA_MAX_BYTES) {
    throw new Error(`Telegram callback_data over ${CALLBACK_DATA_MAX_BYTES} bytes: ${data}`)
  }
  return data
}

function shortTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim()
  return flat.length > BUTTON_TITLE_CHARS ? `${flat.slice(0, BUTTON_TITLE_CHARS - 1)}…` : flat
}

// One Keep / Drop row per idea; with several ideas each button names its idea.
export function ideaVerdictKeyboard(ideas: ReadonlyArray<{ id: string; title?: string }>): InlineKeyboardButton[][] {
  const named = ideas.length > 1
  return ideas.map((idea) => {
    const suffix = named && idea.title?.trim() ? ` · ${shortTitle(idea.title)}` : ''
    return [
      { text: `${IDEA_KEEP_LABEL}${suffix}`, callback_data: inboxCallbackData('accept', idea.id) },
      { text: `${IDEA_DROP_LABEL}${suffix}`, callback_data: inboxCallbackData('dismiss', idea.id) },
    ]
  })
}

// Which idea-verdict button was tapped, read from the message's own keyboard;
// null for any other accept: / dismiss: button (e.g. a speak's Dismiss).
export function tappedIdeaVerdict(keyboard: InlineKeyboardButton[][] | undefined, data: string): IdeaVerdict | null {
  for (const row of keyboard ?? []) {
    const button = row.find((b) => b.callback_data === data)
    if (!button) continue
    if (button.text.startsWith(IDEA_KEEP_LABEL) && data.startsWith('accept:')) return 'kept'
    if (button.text.startsWith(IDEA_DROP_LABEL) && data.startsWith('dismiss:')) return 'dropped'
  }
  return null
}

// The tapped idea's row collapses into one "✓ kept" / "✓ dropped" button
// (re-tapping it reports "Already handled"); every other row stays.
export function settledIdeaKeyboard(keyboard: InlineKeyboardButton[][], data: string, verdict: IdeaVerdict): InlineKeyboardButton[][] {
  return keyboard.map((row) => (row.some((b) => b.callback_data === data) ? [{ text: `✓ ${verdict}`, callback_data: data }] : row))
}
