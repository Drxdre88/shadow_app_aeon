import type { OwnerCardRecord } from '@/lib/data/validators/kairos-owner-model'
import { CARRYING_CARD_TITLE, cardWindow, carryingExternalId, renderCarryingCard } from './card'

// Hourly thinking-sweep step (operator only, KAIROS_OWNER_MODEL=1). Inside the
// window, once per ISO week: an empty week is recorded skipped_empty; a send
// goes through deliverKairosSpeak with force:false + digest:true (gap/cap and
// any gate apply); a 429 is recorded throttled and retried next sweep.

export interface OwnerCardSweepResult {
  ownerCard: { status: OwnerCardRecord['status']; isoWeek: string; reason?: string }
}

export async function runCarryingCardSweep(userId: string, now: Date): Promise<OwnerCardSweepResult | null> {
  const window = cardWindow(now)
  if (!window) return null
  const { isoWeek } = window
  const { mutateKairosOwnerModel, readKairosOwnerModel } = await import('@/lib/data/kairos-owner-model')
  const model = await readKairosOwnerModel(userId)
  const prior = model.cards.find((c) => c.isoWeek === isoWeek)
  if (prior && prior.status !== 'throttled') return null

  const record = (entry: OwnerCardRecord) => mutateKairosOwnerModel(userId, (m) => ({
    state: { ...m, cards: [...m.cards.filter((c) => c.isoWeek !== isoWeek), entry] },
    result: null,
  }), now)

  const card = renderCarryingCard(model, now)
  if (!card) {
    await record({ isoWeek, at: now.toISOString(), status: 'skipped_empty', seqs: [] })
    return { ownerCard: { status: 'skipped_empty', isoWeek } }
  }

  const { deliverKairosSpeak } = await import('@/lib/kairos/speak')
  const outcome = await deliverKairosSpeak(userId, {
    title: CARRYING_CARD_TITLE,
    message: card.message,
    kind: 'notify',
    urgency: 'normal',
    force: false,
    opsAlert: false,
    digest: true,
    externalId: carryingExternalId(isoWeek),
  }, { telegramKeyboard: card.keyboard })

  if (outcome.status !== 200) {
    const reason = typeof outcome.body.error === 'string' ? outcome.body.error : 'throttled'
    await record({ isoWeek, at: now.toISOString(), status: 'throttled', seqs: card.seqs })
    return { ownerCard: { status: 'throttled', isoWeek, reason } }
  }
  await record({ isoWeek, at: now.toISOString(), status: 'sent', memoryId: outcome.body.id, seqs: card.seqs })
  return { ownerCard: { status: 'sent', isoWeek } }
}
