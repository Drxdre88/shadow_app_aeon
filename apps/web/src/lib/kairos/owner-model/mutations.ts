import type { OriginKind } from '@/lib/kairos/origin'
import {
  OWNER_MAX_CONFIRMATIONS,
  OWNER_MAX_SUPPORT_DAYS,
  OWNER_TEXT_MAX,
  type KairosOwnerModel,
  type OwnerConfirmation,
  type OwnerCorrectionAction,
  type OwnerItem,
  type OwnerItemKind,
} from '@/lib/data/validators/kairos-owner-model'
import type { OwnerExtraction } from './extract'
import { MAX_NEW_STATES, MAX_NEW_TRAITS, shouldPromoteTrait } from './rules'
import { findBySeq, isActionable, isLongRunning, isVetoed, isoMs, stateExpiry, vetoFor, VETO_OVERLAP } from './status'
import { clipText, shortDate, tokenOverlap, utcDayOf } from './text'

// Pure owner-model mutations: nightly extraction merge and owner corrections.
// Both run inside mutateKairosOwnerModel (which prunes and caps after).

export interface ProvenanceInfo {
  origin: OriginKind
  createdAt: Date
}

const STATE_ORIGINS: ReadonlySet<OriginKind> = new Set(['operator', 'kairos'])
const TRAIT_ORIGINS: ReadonlySet<OriginKind> = new Set(['operator', 'activity', 'kairos'])
const ANCHORED: ReadonlySet<OriginKind> = new Set(['operator', 'activity'])

const newId = (): string => globalThis.crypto.randomUUID()

function addConfirmation(item: OwnerItem, c: OwnerConfirmation): OwnerItem {
  const days = [...new Set([...item.supportDays, utcDayOf(c.at)])].slice(-OWNER_MAX_SUPPORT_DAYS)
  return { ...item, supportDays: days, confirmations: [...item.confirmations, c].slice(-OWNER_MAX_CONFIRMATIONS) }
}

interface Grounded {
  memoryIds: string[]
  newest: string
  anchored: boolean
}

function groundRows(ids: readonly string[], info: ReadonlyMap<string, ProvenanceInfo>, allowed: ReadonlySet<OriginKind>): Grounded | null {
  const rows = ids.flatMap((id) => {
    const row = info.get(id)
    return row ? [{ id, ...row }] : []
  })
  if (!rows.some((r) => allowed.has(r.origin))) return null
  const newest = Math.max(...rows.map((r) => r.createdAt.getTime()))
  return { memoryIds: rows.map((r) => r.id), newest: new Date(newest).toISOString(), anchored: rows.some((r) => ANCHORED.has(r.origin)) }
}

function sameAs(model: KairosOwnerModel, kind: OwnerItemKind, text: string, now: Date): OwnerItem | undefined {
  return model.items.find((i) => i.kind === kind && isActionable(i, now) && tokenOverlap(i.text, text) >= VETO_OVERLAP)
}

function target(model: KairosOwnerModel, kind: OwnerItemKind, seq: number | null, now: Date): OwnerItem | undefined {
  if (seq === null) return undefined
  const item = findBySeq(model, seq)
  return item && item.kind === kind && isActionable(item, now) ? item : undefined
}

// Nightly merge (Max-plan answers only). A re-confirmation counts only when a
// provenance row is newer than lastConfirmedAt, and the clock follows his
// words (the newest provenance createdAt), not the job time.
export function mergeOwnerExtraction(
  model: KairosOwnerModel,
  extraction: OwnerExtraction,
  info: ReadonlyMap<string, ProvenanceInfo>,
  now: Date,
  ttlDays: number,
): KairosOwnerModel {
  let next: KairosOwnerModel = { ...model, items: [...model.items], vetoes: [...model.vetoes] }
  const replace = (item: OwnerItem) => {
    next = { ...next, items: next.items.map((i) => (i.id === item.id ? item : i)) }
  }
  const create = (kind: OwnerItemKind, text: string, g: Grounded) => {
    const confirmation: OwnerConfirmation = { at: g.newest, via: 'extract', memoryIds: g.memoryIds.slice(0, 12), anchored: g.anchored }
    const item: OwnerItem = {
      id: newId(), seq: next.nextSeq, kind, text, domain: 'general',
      status: kind === 'state' ? 'held' : 'candidate',
      firstSeenAt: g.newest, lastConfirmedAt: g.newest,
      ...(kind === 'state' ? { expiresAt: stateExpiry(g.newest, ttlDays) } : {}),
      supportDays: [utcDayOf(g.newest)], confirmations: [confirmation],
    }
    next = { ...next, nextSeq: next.nextSeq + 1, items: [...next.items, item] }
  }

  let states = 0
  for (const claim of extraction.states) {
    if (states >= MAX_NEW_STATES) break
    const g = groundRows(claim.provenance, info, STATE_ORIGINS)
    if (!g) continue
    const hit = target(next, 'state', claim.targetSeq, now) ?? (claim.relation !== 'ends' ? sameAs(next, 'state', claim.text, now) : undefined)
    if (hit) {
      if (isoMs(g.newest) <= isoMs(hit.lastConfirmedAt)) continue
      if (claim.relation === 'ends') {
        replace({ ...hit, status: 'ended', retiredReason: 'ended', closedAt: now.toISOString() })
      } else {
        const confirmed = { ...hit, status: 'held' as const, lastConfirmedAt: g.newest, expiresAt: stateExpiry(g.newest, ttlDays) }
        replace(addConfirmation(confirmed, { at: g.newest, via: 'extract', memoryIds: g.memoryIds.slice(0, 12), anchored: g.anchored }))
      }
      states++
      continue
    }
    if (claim.relation === 'ends' || isVetoed(next, 'state', claim.text, now)) continue
    if (isoMs(stateExpiry(g.newest, ttlDays)) <= now.getTime()) continue
    create('state', claim.text, g)
    states++
  }

  let traits = 0
  for (const claim of extraction.traits) {
    if (traits >= MAX_NEW_TRAITS) break
    const g = groundRows(claim.provenance, info, TRAIT_ORIGINS)
    if (!g) continue
    const hit = target(next, 'trait', claim.targetSeq, now) ?? sameAs(next, 'trait', claim.text, now)
    if (hit) {
      if (isoMs(g.newest) <= isoMs(hit.lastConfirmedAt)) continue
      let item = addConfirmation({ ...hit, lastConfirmedAt: g.newest }, { at: g.newest, via: 'extract', memoryIds: g.memoryIds.slice(0, 12), anchored: g.anchored })
      if (shouldPromoteTrait(item)) item = { ...item, status: 'held' }
      replace(item)
      traits++
      continue
    }
    if (isVetoed(next, 'trait', claim.text, now)) continue
    create('trait', claim.text, g)
    traits++
  }
  return { ...next, lastExtractAt: now.toISOString() }
}

// ── owner corrections ───────────────────────────────────────────────────────

export type OwnerTarget = { seq: number } | { itemId: string }

export interface OwnerCorrectionOptions {
  via: 'telegram' | 'session'
  text?: string
  updateId?: number | null
  now: Date
  ttlDays: number
}

export type OwnerCorrectionResult =
  | { ok: true; item: OwnerItem; action: OwnerCorrectionAction; label: string }
  | { ok: false; reason: 'not_found' | 'duplicate' }

type Applied = { item: OwnerItem; action: OwnerCorrectionAction; label: string; veto?: boolean }

function correctItem(item: OwnerItem, requested: OwnerCorrectionAction, opts: OwnerCorrectionOptions): Applied {
  const { now } = opts
  const at = now.toISOString()
  const C = `C${item.seq}`
  const owner: OwnerConfirmation = { at, via: opts.via, memoryIds: [], anchored: true }
  const action: OwnerCorrectionAction = requested === 'drop' ? (item.kind === 'state' ? 'over' : 'wrong') : requested
  if (action === 'over') {
    const closed = item.kind === 'state' ? 'ended' : 'retired'
    return { item: { ...item, status: closed, retiredReason: 'owner_over', closedAt: at }, action, label: `${C} over ✓` }
  }
  if (action === 'wrong') {
    return { item: { ...item, status: 'retired', retiredReason: 'owner_wrong', closedAt: at }, action, label: `${C} noted as wrong ✓`, veto: true }
  }
  if (action === 'yes' && isLongRunning(item, now)) {
    const trait = addConfirmation({ ...item, kind: 'trait', status: 'candidate', lastConfirmedAt: at, expiresAt: undefined }, owner)
    return { item: trait, action, label: `${C} kept as part of you ✓` }
  }
  if (action === 'text') {
    const words = (opts.text ?? '').trim()
    const base = { ...item, text: clipText(words), ownerText: words.slice(0, OWNER_TEXT_MAX), lastConfirmedAt: at, status: 'held' as const }
    const updated = item.kind === 'state' ? { ...base, expiresAt: stateExpiry(at, opts.ttlDays) } : base
    return { item: addConfirmation(updated, owner), action, label: `${C} updated in your words ✓` }
  }
  // still / yes: re-confirmed now; an owner "yes" promotes a trait at once.
  if (item.kind === 'state') {
    const expiresAt = stateExpiry(at, opts.ttlDays)
    return { item: addConfirmation({ ...item, status: 'held', lastConfirmedAt: at, expiresAt }, owner), action, label: `${C} kept to ${shortDate(expiresAt)} ✓` }
  }
  return { item: addConfirmation({ ...item, status: 'held', lastConfirmedAt: at }, owner), action, label: `${C} kept ✓` }
}

export function applyOwnerCorrection(
  model: KairosOwnerModel,
  ref: OwnerTarget,
  action: OwnerCorrectionAction,
  opts: OwnerCorrectionOptions,
): { state: KairosOwnerModel | null; result: OwnerCorrectionResult } {
  const updateId = opts.updateId ?? undefined
  if (updateId !== undefined && model.corrections.some((c) => c.updateId === updateId)) {
    return { state: null, result: { ok: false, reason: 'duplicate' } }
  }
  const item = 'seq' in ref ? findBySeq(model, ref.seq) : model.items.find((i) => i.id === ref.itemId)
  if (!item || !isActionable(item, opts.now)) return { state: null, result: { ok: false, reason: 'not_found' } }
  const applied = correctItem(item, action, opts)
  const at = opts.now.toISOString()
  const lastCard = [...model.cards].reverse().find((c) => c.seqs.includes(item.seq))
  const cards = lastCard
    ? model.cards.map((c) => (c === lastCard ? { ...c, acted: [...new Set([...(c.acted ?? []), item.seq])] } : c))
    : model.cards
  const state: KairosOwnerModel = {
    ...model,
    items: model.items.map((i) => (i.id === item.id ? applied.item : i)),
    vetoes: applied.veto ? [...model.vetoes, vetoFor(item, opts.now)] : model.vetoes,
    cards,
    corrections: [...model.corrections, {
      at, seq: item.seq, action: applied.action, via: opts.via,
      ...(applied.action === 'text' ? { text: (opts.text ?? '').trim().slice(0, OWNER_TEXT_MAX) } : {}),
      ...(updateId !== undefined ? { updateId } : {}),
    }],
  }
  return { state, result: { ok: true, item: applied.item, action: applied.action, label: applied.label } }
}
