import { acceptInboxProposal, dismissInboxMemory } from '../proposal-accept'
import { dismissKairosAsk } from '../ask'
import { settleKairosPredictionByOwner } from '../predictions/verdict'
import { predictionsEnabled } from '../predictions/flag'
import { decideKairosProposal } from '../proposal-decision'
import { TELEGRAM_OWNER_ORIGIN } from '../idea-verdict-telegram'
import type { DeckOutcome } from './parse'
import type { DeckItem, DeckToken } from './types'

// One deck verdict → the existing owner handler for that item's kind, with
// operator / telegram origin. Skip never calls anything (skip is never a no).
//   idea      yes → accept (kept)        no → dismiss (dropped)
//   question  yes → ask for the answer   no → set aside (dismissed, no negative)
//   R         yes → right                no → wrong
//   proposal  yes → approve              no → veto

async function decide(userId: string, item: DeckItem, yes: boolean, now: Date): Promise<DeckOutcome> {
  const n = item.n
  const done = (word: string): DeckOutcome => ({ n, status: 'done', word })
  const handled: DeckOutcome = { n, status: 'already_handled' }
  switch (item.kind) {
    case 'idea': {
      const res = yes
        ? await acceptInboxProposal(userId, item.id, TELEGRAM_OWNER_ORIGIN)
        : await dismissInboxMemory(userId, item.id, TELEGRAM_OWNER_ORIGIN)
      return res.ok ? done(yes ? 'kept' : 'dropped') : handled
    }
    case 'ask': {
      // A question needs words, not a yes/no (card-notes answers even write onto
      // cards): "n" sets it aside like "skip Q12"; "y" asks for the answer.
      if (yes) return { n, status: 'needs_text', word: item.label ? `${item.label}: …` : 'Q…: …' }
      const res = await dismissKairosAsk(userId, item.id, now)
      return 'ok' in res ? done('set aside') : handled
    }
    case 'prediction': {
      if (!predictionsEnabled()) return { n, status: 'unknown' }
      const res = await settleKairosPredictionByOwner(userId, item.id, yes ? 'right' : 'wrong', { via: 'telegram' }, now)
      if (res.ok) return done(yes ? 'right' : 'wrong')
      return res.reason === 'already_settled' || res.reason === 'not_found' ? handled : { n, status: 'failed' }
    }
    case 'proposal': {
      const res = await decideKairosProposal(userId, item.id, { verdict: yes ? 'approve' : 'veto', via: 'telegram', now, origin: TELEGRAM_OWNER_ORIGIN })
      if (res.ok) return done(yes ? 'approved' : 'vetoed')
      return res.reason === 'already_decided' || res.reason === 'expired' || res.reason === 'not_found' ? handled : { n, status: 'failed' }
    }
  }
}

export async function applyDeckTokens(
  userId: string,
  items: ReadonlyArray<DeckItem>,
  tokens: ReadonlyArray<DeckToken>,
  now: Date,
): Promise<DeckOutcome[]> {
  const byNumber = new Map(items.map((i) => [i.n, i]))
  const out: DeckOutcome[] = []
  for (const token of tokens) {
    const item = byNumber.get(token.n)
    if (!item) {
      out.push({ n: token.n, status: 'unknown' })
      continue
    }
    if (token.verdict === 'skip') {
      out.push({ n: token.n, status: 'skipped' })
      continue
    }
    try {
      out.push(await decide(userId, item, token.verdict === 'yes', now))
    } catch (err) {
      console.error('[kairos:verdict-deck] verdict failed', { n: token.n, kind: item.kind, err })
      out.push({ n: token.n, status: 'failed' })
    }
  }
  return out
}
