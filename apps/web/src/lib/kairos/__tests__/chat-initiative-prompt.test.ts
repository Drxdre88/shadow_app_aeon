import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import {
  buildChatSystemPrompt,
  TELEGRAM_CHAT_PERSONA,
  type ChatPromptPendingAsk,
} from '../chat-prompt'

const pendingAsk: ChatPromptPendingAsk = {
  question: 'Should the dormant mobile release be revived this month?',
  kind: 'revival',
  rationale: 'The release card has not moved for 31 days.',
  sourceSnippets: [{
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Ship mobile release',
    body: 'Aeon · todo · high · updated 31 days ago',
  }],
}

describe('ask-aware chat prompt', () => {
  it('includes the open ask block with evidence only when an ask exists', () => {
    const withoutAsk = buildChatSystemPrompt(null, undefined, 'telegram')
    const withAsk = buildChatSystemPrompt(null, undefined, 'telegram', pendingAsk)

    expect(withoutAsk).not.toContain('## Open question from you')
    expect(withAsk).toContain('## Open question from you')
    expect(withAsk).toContain(`Question: ${pendingAsk.question}`)
    expect(withAsk).toContain('Kind: revival')
    expect(withAsk).toContain(`Rationale: ${pendingAsk.rationale}`)
    expect(withAsk).toContain('### Ship mobile release [[11111111-1111-4111-8111-111111111111]]')
    expect(withAsk).toContain('updated 31 days ago')
  })

  it('keeps the one-follow-up rule in the Telegram persona snapshot', () => {
    expect(TELEGRAM_CHAT_PERSONA).toMatchInlineSnapshot(`
      [
        "- Start with exactly one concrete **bold headline** of at most 60 characters and at most one emoji. Do not use a Markdown heading.",
        "- Follow with a one-sentence hook, then 2–4 short flat paragraphs. Use italics only for asides and \`code\` for identifiers. Never write bullet walls, tables, nested lists, or more than two emoji total.",
        "- Include exactly one visible blockquote quoting real evidence from the supplied context. Put deeper receipts, sources, and source ids in one expandable blockquote at the bottom using \`>>!\` lines.",
        "- Use strikethrough only for a concrete declared-versus-verified contrast. On asks only, you may include at most one hidden guess as \`My guess: ||...|| — tell me I'm wrong.\`",
        "- Close with a single question or call to action. Never present a text menu.",
        "- When the operator has answered your open ask, probe motive or reasons with at most ONE follow-up question. Never leave more than one open question on the table.",
        "- When the operator pushes a topic, follow their lead instead of steering back to your prior agenda.",
      ]
    `)
  })
})
