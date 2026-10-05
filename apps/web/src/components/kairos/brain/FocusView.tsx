'use client'

import { useCallback, useEffect, useState } from 'react'
import { Compass } from 'lucide-react'
import { getFocusOverview, setDominionPinnedAction, type FocusOverview } from '@/lib/actions/dominion-focus'
import type { LivingDominionsMode } from '@/lib/kairos/living/flag'
import { MIND_NAME } from '@/lib/kairos/identity'
import { Chip, Code, Eyebrow, Panel, tint } from './brainUi'
import { localDateTime } from './brainTime'
import { FocusRow } from './FocusRow'
import { FocusEmpty, FocusErrorStrip, FocusSkeleton, UnattributedList } from './focusUi'

const MODE: Record<LivingDominionsMode, { label: string; tone: string }> = {
  off: { label: 'Off', tone: 'var(--text-dim)' },
  observe: { label: 'Watch-only', tone: 'var(--primary)' },
  on: { label: 'On', tone: 'var(--success)' },
}

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong'
}

function latestScore(data: FocusOverview): string | null {
  const stamps = data.dominions.map((d) => d.activityScoredAt).filter((s): s is string => !!s)
  return stamps.length ? stamps.reduce((a, b) => (a > b ? a : b)) : null
}

function ModeBanner({ mode }: { mode: LivingDominionsMode }) {
  return (
    <p className="text-[12px] leading-relaxed text-white/60">
      {mode === 'off' && <>Switched off — set <Code>KAIROS_LIVING_DOMINIONS=observe</Code> to start watching</>}
      {mode === 'observe' && `Watch-only: this is where ${MIND_NAME} thinks your time went. Nothing he says changes yet.`}
      {mode === 'on' && `On: ${MIND_NAME} follows these areas; dormant ones are left out of his focus.`}
    </p>
  )
}

export function FocusView() {
  const [data, setData] = useState<FocusOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    getFocusOverview()
      .then((next) => { if (alive) { setData(next); setError(null) } })
      .catch((e: unknown) => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const patch = (id: string, fields: Partial<FocusOverview['dominions'][number]>) =>
    setData((d) => d && { ...d, dominions: d.dominions.map((x) => (x.id === id ? { ...x, ...fields } : x)) })

  const togglePin = async (id: string, pinned: boolean, focusState: string) => {
    const next = !pinned
    patch(id, { pinned: next, dormant: !next && focusState === 'dormant' })
    setSaving(id)
    try {
      const res = await setDominionPinnedAction({ dominionId: id, pinned: next })
      patch(id, { pinned: res.pinned, focusState: res.focusState, dormant: !res.pinned && res.focusState === 'dormant' })
      setError(null)
    } catch (e) {
      patch(id, { pinned, dormant: !pinned && focusState === 'dormant' })
      setError(errorText(e))
    } finally {
      setSaving(null)
    }
  }

  const scoredAt = data ? latestScore(data) : null
  const topScore = data ? Math.max(0, ...data.dominions.map((d) => d.activityScore)) : 0
  const mode = data ? MODE[data.mode] : null

  return (
    <section className="flex flex-col gap-3" aria-labelledby="kairos-focus-title">
      {error && <FocusErrorStrip message={error} onRetry={reload} />}

      <Panel>
        <div className="flex items-start gap-3 px-5 pt-4 pb-3.5 border-b border-white/[0.06]">
          <div
            className="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            style={{ background: tint('var(--primary)', 12), color: 'var(--primary)' }}
          >
            <Compass className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id="kairos-focus-title" className="text-[13px] font-semibold text-white">Where your time went</h3>
              {mode && <Chip tone={mode.tone}>{mode.label}</Chip>}
              {scoredAt && <span className="ml-auto text-[10.5px] text-white/40">Scored {localDateTime(scoredAt)}</span>}
            </div>
            {data && <div className="mt-1"><ModeBanner mode={data.mode} /></div>}
          </div>
        </div>

        {!data ? (
          error ? <FocusEmpty>Couldn’t load your areas.</FocusEmpty> : <FocusSkeleton />
        ) : data.dominions.length === 0 ? (
          <FocusEmpty>No areas yet.</FocusEmpty>
        ) : !scoredAt ? (
          <FocusEmpty>Scores appear after the first nightly run at 01:10 UTC.</FocusEmpty>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {data.dominions.map((d) => (
              <FocusRow
                key={d.id}
                dominion={d}
                topScore={topScore}
                nowIso={data.generatedAt}
                saving={saving === d.id}
                onTogglePin={() => { void togglePin(d.id, d.pinned, d.focusState) }}
              />
            ))}
          </div>
        )}
      </Panel>

      {data?.unattributed && (data.unattributed.boards.length > 0 || data.unattributed.repos.length > 0) && (
        <div className="flex flex-col gap-2 pt-2">
          <Eyebrow>Work that belongs nowhere</Eyebrow>
          <p className="text-[11.5px] text-white/50">Recent work that isn’t in any area yet. Later, {MIND_NAME} will suggest where it goes.</p>
          <UnattributedList unattributed={data.unattributed} />
        </div>
      )}
    </section>
  )
}
