'use client'

import type { KairosDecisionView } from '@/lib/kairos/decisions/types'
import type { DecisionVerdict } from '@/lib/data/validators/kairos-decisions'
import { decisionStatusText, percent } from '@/lib/kairos/decisions/render'
import { BUTTON } from './styles'

export type RowAction = { kind: 'settle'; verdict: DecisionVerdict } | { kind: 'confirm' } | { kind: 'discard' }

const STATUS_TONE: Record<KairosDecisionView['status'], string> = {
  open: 'text-white/40',
  right: 'text-emerald-200/80',
  wrong: 'text-rose-200/80',
  void: 'text-white/35',
}

export function DecisionRow({ d, working, onAction }: { d: KairosDecisionView; working: boolean; onAction: (id: string, action: RowAction) => void }) {
  const tone = d.needsConfirm ? 'text-amber-200/80' : d.due ? 'text-violet-200/85' : STATUS_TONE[d.status]
  return (
    <li className="rounded-lg bg-black/10 border border-white/[0.05] px-3 py-2.5">
      <p className="text-[12px] text-white/80">
        <span className="text-white/35 mr-1.5">{d.number}</span>
        {d.decision}
      </p>
      <p className="mt-0.5 text-[11px] text-white/50">Expect: {d.expectation}</p>
      <p className="mt-0.5 text-[10px] text-white/35">
        {d.typeLabel} · {percent(d.probability)} sure · <span className={tone}>{decisionStatusText(d)}</span>
      </p>
      {d.status === 'open' && (
        <div className="mt-2 flex items-center gap-2">
          {d.needsConfirm ? (
            <>
              <button type="button" className={BUTTON} disabled={working} onClick={() => onAction(d.id, { kind: 'confirm' })}>✓ Mine, confirm</button>
              <button type="button" className={BUTTON} disabled={working} onClick={() => onAction(d.id, { kind: 'discard' })}>Not mine</button>
            </>
          ) : (
            <>
              <button type="button" className={BUTTON} disabled={working} onClick={() => onAction(d.id, { kind: 'settle', verdict: 'right' })}>✓ Right</button>
              <button type="button" className={BUTTON} disabled={working} onClick={() => onAction(d.id, { kind: 'settle', verdict: 'wrong' })}>✗ Wrong</button>
              <button type="button" className={BUTTON} disabled={working} onClick={() => onAction(d.id, { kind: 'settle', verdict: 'void' })}>Void</button>
            </>
          )}
        </div>
      )}
    </li>
  )
}
