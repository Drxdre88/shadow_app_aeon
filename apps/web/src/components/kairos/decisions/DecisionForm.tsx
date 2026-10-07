'use client'

import { useState } from 'react'
import { DECISION_TYPE_PRESETS } from '@/lib/kairos/decisions/types'
import { BUTTON_PRIMARY, FIELD, LABEL } from './styles'

export interface DecisionDraft {
  decision: string
  expectation: string
  probability: number
  decisionType: string
  checkBy: string
}

const OTHER = '__other'

function inDays(days: number, now: Date = new Date()): string {
  const at = new Date(now.getTime() + days * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export function DecisionForm({ onSubmit, working }: { onSubmit: (draft: DecisionDraft) => Promise<boolean>; working: boolean }) {
  const [decision, setDecision] = useState('')
  const [expectation, setExpectation] = useState('')
  const [sure, setSure] = useState(70)
  const [preset, setPreset] = useState<string>(DECISION_TYPE_PRESETS[0]!.key)
  const [otherType, setOtherType] = useState('')
  const [checkBy, setCheckBy] = useState(() => inDays(30))

  const decisionType = preset === OTHER ? otherType.trim() : preset
  const ready = decision.trim().length >= 5 && expectation.trim().length >= 3 && decisionType.length >= 2 && Boolean(checkBy)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!ready || working) return
    const saved = await onSubmit({ decision: decision.trim(), expectation: expectation.trim(), probability: sure / 100, decisionType, checkBy })
    if (saved) {
      setDecision('')
      setExpectation('')
    }
  }

  return (
    <form onSubmit={submit} aria-label="Log a decision" className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Decision</span>
        <input value={decision} onChange={(e) => setDecision(e.target.value)} maxLength={300} placeholder="Back Hydra over Visor this quarter" className={FIELD} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>What you expect</span>
        <input value={expectation} onChange={(e) => setExpectation(e.target.value)} maxLength={300} placeholder="Hydra has 3 paying users by the check-by date" className={FIELD} />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>How sure · {sure}%</span>
          <input type="range" min={50} max={95} step={5} value={sure} onChange={(e) => setSure(Number(e.target.value))} aria-label="How sure" className="accent-violet-300" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Type</span>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Decision type" className={FIELD}>
            {DECISION_TYPE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.short}</option>)}
            <option value={OTHER}>Other…</option>
          </select>
          {preset === OTHER && (
            <input value={otherType} onChange={(e) => setOtherType(e.target.value)} maxLength={40} placeholder="e.g. pricing" aria-label="Other decision type" className={FIELD} />
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Check by</span>
          <input type="date" value={checkBy} onChange={(e) => setCheckBy(e.target.value)} aria-label="Check by" className={FIELD} />
        </label>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-white/35">Only calls you make yourself — not for trades.</p>
        <button type="submit" disabled={!ready || working} className={BUTTON_PRIMARY} style={{ backgroundColor: 'color-mix(in srgb, var(--primary) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 35%, transparent)' }}>
          {working ? 'Saving…' : 'Log decision'}
        </button>
      </div>
    </form>
  )
}
