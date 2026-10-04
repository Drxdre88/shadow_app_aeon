import type { OwnerCorrectionAction } from '@/lib/data/validators/kairos-owner-model'
import { isoWeekKey } from '@/lib/kairos/thinking/deadlines'
import { ownerStateTtlDays } from './flag'
import type { OwnerCorrectionResult, OwnerTarget } from './mutations'
import { neutralise } from './text'

// The one owner-correction entry point (Telegram commands, card buttons, web
// card). Updates the model (vetoing on "wrong"), logs a 'decided' today entry,
// and for free text also writes ONE operator-origin reflection in his words so
// the correction reaches beliefs, Aether and the next extraction. Button taps
// write no reflection. Agents never reach this (no MCP/REST writer).

export interface CorrectOwnerOptions {
  via: 'telegram' | 'session'
  text?: string
  updateId?: number | null
}

export async function correctOwnerItem(
  userId: string,
  ref: OwnerTarget,
  action: OwnerCorrectionAction,
  opts: CorrectOwnerOptions,
  now: Date = new Date(),
): Promise<OwnerCorrectionResult> {
  const { mutateKairosOwnerModel } = await import('@/lib/data/kairos-owner-model')
  const { applyOwnerCorrection } = await import('./mutations')
  const ttlDays = ownerStateTtlDays()
  const result = await mutateKairosOwnerModel(userId, (model) =>
    applyOwnerCorrection(model, ref, action, { via: opts.via, text: opts.text, updateId: opts.updateId, now, ttlDays }), now)
  if (!result.ok) return result

  const channel = opts.via === 'telegram' ? 'telegram' : 'inbox'
  const origin = { kind: 'operator' as const, via: `${opts.via}:owner-card` }
  const C = `C${result.item.seq}`
  const stamp = opts.updateId ?? now.getTime()
  try {
    const { recordToday } = await import('@/lib/kairos/today')
    const said = result.action === 'text' ? `: ${neutralise(opts.text ?? '')}` : ` ${result.action}`
    await recordToday(userId, {
      key: `owner-card:${C}:${stamp}`,
      channel,
      type: 'decided',
      text: `Corrected Kairos's read ${C} (${neutralise(result.item.text)})${said}`,
    }, origin)
  } catch (err) {
    console.warn('[kairos:owner-model] today log failed', err)
  }

  if (result.action === 'text' && opts.text?.trim()) {
    try {
      const { captureMemory } = await import('@/lib/data/memories')
      const words = opts.text.trim()
      await captureMemory(userId, {
        type: 'reflection',
        streamClass: 'reflection',
        source: 'manual',
        title: `What I'm carrying — ${neutralise(result.item.text).slice(0, 80)}`,
        bodyMd: words,
        summary: words.slice(0, 1000),
        sourceMetadata: {
          externalId: `owner-card:${isoWeekKey(now)}:${result.item.seq}:${stamp}`,
          ownerCard: { seq: result.item.seq, itemKind: result.item.kind, via: opts.via },
        },
      }, { origin })
    } catch (err) {
      console.error('[kairos:owner-model] correction reflection failed', err)
    }
  }
  return result
}
