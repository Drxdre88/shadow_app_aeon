import { askFirstMode } from '@/lib/kairos/advise/flag'
import { classifyAdviceTurn, type AdviceVerdict } from '@/lib/kairos/advise/classify'
import { adviceStyleLines } from '@/lib/kairos/advise/lines'
import { coldReadEnabled } from '@/lib/kairos/cold-read/flag'
import { resolveTurnArea } from '@/lib/kairos/trust/areas'
import { trustMode } from '@/lib/kairos/trust/flag'
import { isLondonMonday, londonDay } from '@/lib/kairos/trust/london'
import { buildTrustFooter, buildTrustTailLine, hasTrustFooterFor, stripTrustFooter } from '@/lib/kairos/trust/render'
import type { MomentChatContribution, MomentLane, MomentReplyContext } from '../types'

// Lane D (earned trust per area, ask before advising). Trust never enters a
// prompt: chatContext only adds advice-framing lines (KAIROS_ASK_FIRST); the
// trust footer (KAIROS_TRUST) is appended after the reply and stripped from
// history; the Monday 06:00 tail line is code-built. lib/data is lazy-imported.

function adviceContribution(verdict: AdviceVerdict): MomentChatContribution | null {
  if (verdict.mode === 'none') return null
  const styleLines = adviceStyleLines(verdict.mode, { coldRead: coldReadEnabled() })
  return { styleLines, ...(verdict.mode === 'offer' ? { brief: true } : {}) }
}

async function trustFooterFor(content: string, ctx: MomentReplyContext, now: Date): Promise<string | null> {
  const { getChatThread } = await import('@/lib/data/kairos-chat')
  const thread = await getChatThread(ctx.userId, ctx.threadId)
  if (!thread) return null
  const prior = thread.messages.filter((m) => m.seq < ctx.userSeq)
  const history = prior.map((m) => ({ role: m.role, content: stripTrustFooter(m.content) }))
  if (classifyAdviceTurn({ userBody: ctx.userBody, history }).mode !== 'advise') return null

  const { readKairosTrust } = await import('@/lib/data/kairos-trust')
  const view = await readKairosTrust(ctx.userId, { now })
  const dominions = view.areas.filter((a) => a.kind === 'dominion').map((a) => ({ id: a.key, name: a.label }))
  const key = resolveTurnArea(ctx.userBody, thread.thread.dominionId, dominions)
  const area = key ? view.areas.find((a) => a.key === key) : undefined
  if (!area || area.level === 'unknown') return null

  const today = londonDay(now).date
  const shownToday = thread.messages.some((m) =>
    m.role === 'assistant' && londonDay(new Date(m.createdAt)).date === today && hasTrustFooterFor(m.content, area.label))
  if (shownToday || hasTrustFooterFor(content, area.label)) return null
  return buildTrustFooter(area)
}

export const adviseTrustLane: MomentLane = {
  chatContext(ctx) {
    const mode = askFirstMode()
    if (mode === 'off') return null
    const verdict = classifyAdviceTurn({ userBody: ctx.userBody, history: ctx.history })
    if (mode === 'observe') {
      console.info('[kairos:advise] observe', { threadId: ctx.threadId, userSeq: ctx.userSeq, mode: verdict.mode, reason: verdict.reason })
      return null
    }
    return adviceContribution(verdict)
  },

  async finishReply(content, ctx) {
    const mode = trustMode()
    if (mode === 'off') return content
    const footer = await trustFooterFor(content, ctx, new Date())
    if (!footer) return content
    if (mode === 'observe') {
      console.info('[kairos:trust] observe footer', { threadId: ctx.threadId, userSeq: ctx.userSeq, footer: footer.slice(0, 160) })
      return content
    }
    return `${content.trimEnd()}\n\n${footer}`
  },

  stripFooter(content) {
    return stripTrustFooter(content)
  },

  async daily(userId, now) {
    const mode = trustMode()
    if (mode === 'off' || !isLondonMonday(now)) return null
    const { readKairosTrust } = await import('@/lib/data/kairos-trust')
    const line = buildTrustTailLine(await readKairosTrust(userId, { now }), now)
    if (!line) return null
    if (mode === 'observe') {
      console.info('[kairos:trust] observe tail', { line: line.slice(0, 160) })
      return null
    }
    return { tail: [line] }
  },
}
