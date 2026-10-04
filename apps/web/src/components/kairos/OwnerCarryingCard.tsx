'use client'

import { useCallback, useEffect, useState } from 'react'
import { HeartHandshake } from 'lucide-react'
import type { OwnerCardItem } from '@/lib/actions/kairos-owner-model'

// "What I think you're carrying" (wave 4 lane B): Kairos's working read of
// the owner, correctable here or on Telegram. Renders nothing unless
// KAIROS_OWNER_MODEL=1 and something is live. The server actions load lazily
// so the inbox never pulls them in until the card mounts.

const actions = () => import('@/lib/actions/kairos-owner-model')

export const OWNER_CORRECTION_MAX = 500

type Action = 'still' | 'over' | 'wrong' | 'text'

function shortDate(iso: string | null): string {
  if (!iso) return '?'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '?'
  return at.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Europe/London' })
}

export function ownerItemDetail(item: OwnerCardItem): string {
  if (item.kind === 'trait') return item.candidate ? 'right?' : 'lasting'
  const dates = `since ${shortDate(item.firstSeenAt)}, lapses ${shortDate(item.expiresAt)}`
  return item.longRunning ? `${dates} — still a phase, or part of you?` : dates
}

const BUTTON = 'px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-white/75 hover:bg-white/[0.07] disabled:opacity-35'

function OwnerItemRow({
  item,
  working,
  outcome,
  onCorrect,
}: {
  item: OwnerCardItem
  working: boolean
  outcome: string | undefined
  onCorrect: (id: string, action: Action, text?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const keep = item.kind === 'state' ? 'Still' : 'Yes'
  const drop = item.kind === 'state' ? 'Over' : 'Wrong'
  return (
    <li className="rounded-lg bg-black/10 border border-white/[0.05] px-3 py-2.5">
      <p className="text-[12px] text-white/80">
        <span className="text-white/35 mr-1.5">C{item.seq}</span>
        {item.text}
      </p>
      <p className="mt-0.5 text-[10px] text-white/35">{ownerItemDetail(item)}</p>
      {outcome ? (
        <p role="status" className="mt-2 text-[10px] uppercase tracking-[0.16em] text-emerald-200/80">{outcome}</p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className={BUTTON} disabled={working} onClick={() => onCorrect(item.id, 'still')}>
              ✓ {keep}
            </button>
            <button type="button" className={BUTTON} disabled={working} onClick={() => onCorrect(item.id, item.kind === 'state' ? 'over' : 'wrong')}>
              ✗ {drop}
            </button>
            {item.kind === 'state' && (
              <button type="button" className={BUTTON} disabled={working} onClick={() => onCorrect(item.id, 'wrong')}>
                Not true
              </button>
            )}
            <button type="button" className={BUTTON} disabled={working} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
              Correct…
            </button>
          </div>
          {editing && (
            <>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={2}
                maxLength={OWNER_CORRECTION_MAX}
                aria-label={`Correct C${item.seq}`}
                placeholder="What's really going on?"
                className="mt-2 w-full resize-none rounded-lg bg-black/20 border border-white/[0.08] px-3 py-2 text-[12px] leading-relaxed text-white/85 placeholder:text-white/30 outline-none focus:border-violet-400/35"
              />
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => onCorrect(item.id, 'text', text.trim())}
                  disabled={text.trim().length < 3 || working}
                  className="px-3 py-1.5 rounded-md border text-[10px] uppercase tracking-[0.16em] text-white hover:brightness-125 disabled:opacity-35 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
                  }}
                >
                  {working ? 'Sending…' : 'Send'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </li>
  )
}

export function OwnerCarryingCard({ ownerModelEnabled }: { ownerModelEnabled: boolean }) {
  const [items, setItems] = useState<OwnerCardItem[] | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!ownerModelEnabled) return
    let alive = true
    actions()
      .then(({ getKairosOwnerCard }) => getKairosOwnerCard())
      .then((data) => { if (alive) setItems(data.enabled ? data.items : null) })
      .catch(() => { if (alive) setItems(null) })
    return () => { alive = false }
  }, [ownerModelEnabled])

  const onCorrect = useCallback(async (id: string, action: Action, text?: string) => {
    setWorking(id)
    try {
      const { correctKairosOwnerItem } = await actions()
      const res = await correctKairosOwnerItem(id, action, text)
      setOutcomes((prev) => ({ ...prev, [id]: res.ok ? res.label : 'No longer open' }))
    } catch {
      setOutcomes((prev) => ({ ...prev, [id]: 'Could not update — try again' }))
    } finally {
      setWorking(null)
    }
  }, [])

  if (!ownerModelEnabled || !items || items.length === 0) return null
  return (
    <section aria-label="What I think you're carrying" className="mb-5 rounded-xl bg-white/[0.04] border border-violet-300/15 p-4">
      <div className="flex items-center gap-1.5">
        <HeartHandshake className="w-3.5 h-3.5 text-violet-200/70" aria-hidden="true" />
        <h3 className="text-[12px] font-medium text-white/85">What I think you&apos;re carrying</h3>
      </div>
      <p className="mt-1 text-[10px] text-white/35">My working read — correct anything that&apos;s off. States lapse unless you re-confirm them.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <OwnerItemRow key={item.id} item={item} working={working === item.id} outcome={outcomes[item.id]} onCorrect={onCorrect} />
        ))}
      </ul>
    </section>
  )
}
