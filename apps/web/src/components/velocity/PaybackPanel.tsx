'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Rocket } from 'lucide-react'
import { getAgentPayback } from '@/lib/actions/payback'
import type { PaybackBucket, PaybackView } from '@/lib/data/payback'
import type { PaybackPeriod } from '@/lib/data/validators/payback'
import { formatUsd } from '@/lib/kairos/payback/render'

interface PaybackPanelProps {
  projectId: string
  range: PaybackPeriod
}

type LoadState = { key: string; view: PaybackView | null; error: boolean }

const cardClass = 'backdrop-blur-xl bg-white/[0.06] border border-amber-500/20 rounded-xl p-4'
const titleClass = 'text-xs text-slate-400 font-medium uppercase tracking-wider'

function Stat({ label, value, hint, tone = 'text-slate-100' }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2" title={hint}>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  )
}

function BucketList({ title, buckets }: { title: string; buckets: PaybackBucket[] }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-1.5">{title}</div>
      <ul className="space-y-1">
        {buckets.slice(0, 5).map((b) => (
          <li key={b.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-300 truncate">{b.key}</span>
            <span className="text-slate-500 shrink-0">
              {b.missions} · {b.missions > b.missionsWithUnknownCost ? formatUsd(b.costKnownUsd) : 'cost unknown'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PaybackPanel({ projectId, range }: PaybackPanelProps) {
  const key = `${projectId}:${range}`
  const [state, setState] = useState<LoadState | null>(null)

  useEffect(() => {
    let cancelled = false
    getAgentPayback({ projectId, period: range })
      .then((view) => { if (!cancelled) setState({ key, view, error: false }) })
      .catch(() => { if (!cancelled) setState({ key, view: null, error: true }) })
    return () => { cancelled = true }
  }, [key, projectId, range])

  const loading = !state || state.key !== key

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={cardClass} data-testid="payback-panel">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
          <Rocket className="w-3.5 h-3.5 text-amber-400" />
        </div>
        <div className={titleClass}>Hangar payback</div>
      </div>
      {loading ? (
        <div className="h-20 rounded-lg bg-white/[0.04] animate-pulse" />
      ) : state.error || !state.view ? (
        <div className="flex items-center justify-center h-16 text-slate-500 text-sm">Couldn&apos;t load Hangar costs right now.</div>
      ) : state.view.totals.missions === 0 ? (
        <div className="flex items-center justify-center h-16 text-slate-500 text-sm">No Hangar missions on this board in this period.</div>
      ) : (
        <PaybackBody view={state.view} />
      )}
    </motion.div>
  )
}

function PaybackBody({ view }: { view: PaybackView }) {
  const t = view.totals
  const engines = view.breakdowns.engine ?? []
  const models = view.breakdowns.model ?? []
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        <Stat label="Missions" value={String(t.missions)} />
        <Stat label="Finished" value={String(t.succeeded)} tone="text-emerald-300" />
        <Stat label="Failed" value={String(t.failed)} tone="text-rose-300" />
        <Stat label="Runner died" value={String(t.runnerDied)} tone="text-amber-300" hint="Timed out or killed without you asking — the PC slept, ran out of memory or stopped reporting. Not counted as a failure." />
        <Stat label="Stopped by you" value={String(t.ownerStopped)} tone="text-slate-300" hint="Missions you stopped yourself from the app, Claude or the API." />
        <Stat label="Known cost" value={formatUsd(t.costKnownUsd)} />
        <Stat label="No cost recorded" value={String(t.missionsWithUnknownCost)} tone="text-slate-400" hint="These missions are left out of the cost, not counted as free." />
        <Stat label="Per finished mission" value={t.costPerSucceeded === null ? 'Unknown' : formatUsd(t.costPerSucceeded)} hint="All known cost divided by finished missions that have a cost." />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <BucketList title="By engine" buckets={engines} />
        <BucketList title="By model" buckets={models} />
        <div>
          <div className="text-[11px] text-slate-500 mb-1.5">Most expensive cards</div>
          {view.topCards.length === 0 ? (
            <div className="text-xs text-slate-500">No card has a recorded cost yet.</div>
          ) : (
            <ul className="space-y-1">
              {view.topCards.slice(0, 5).map((c) => (
                <li key={c.taskId} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-300 truncate" title={c.cardName}>{c.cardName}</span>
                  <span className="text-slate-500 shrink-0">{formatUsd(c.costKnownUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
