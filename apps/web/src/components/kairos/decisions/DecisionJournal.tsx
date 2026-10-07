'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Scale } from 'lucide-react'
import {
  confirmOwnKairosDecision,
  discardOwnKairosDecision,
  logOwnKairosDecision,
  settleOwnKairosDecision,
  type DecisionActionResult,
} from '@/lib/actions/kairos-decisions'
import type { KairosDecisionsList } from '@/lib/kairos/decisions/types'
import { CalibrationPanel } from './CalibrationPanel'
import { DecisionForm, type DecisionDraft } from './DecisionForm'
import { DecisionRow, type RowAction } from './DecisionRow'

function runAction(id: string, action: RowAction): Promise<DecisionActionResult> {
  if (action.kind === 'settle') return settleOwnKairosDecision(id, action.verdict)
  if (action.kind === 'confirm') return confirmOwnKairosDecision(id)
  return discardOwnKairosDecision(id)
}

export function DecisionJournal({ initial }: { initial: KairosDecisionsList }) {
  const [list, setList] = useState(initial)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apply = (res: DecisionActionResult): boolean => {
    if (!res.ok) { setError(res.error); return false }
    setError(null)
    setList(res.list)
    return true
  }

  const onLog = async (draft: DecisionDraft): Promise<boolean> => {
    setWorking('form')
    try {
      return apply(await logOwnKairosDecision(draft))
    } catch {
      setError('Could not save — try again')
      return false
    } finally {
      setWorking(null)
    }
  }

  const onAction = async (id: string, action: RowAction) => {
    setWorking(id)
    try {
      apply(await runAction(id, action))
    } catch {
      setError('Could not update — try again')
    } finally {
      setWorking(null)
    }
  }

  const open = list.decisions.filter((d) => d.status === 'open')
  const settled = list.decisions.filter((d) => d.status !== 'open').slice(0, 20)

  return (
    <div className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 flex flex-col gap-5">
        <header className="flex items-center gap-3">
          <Link href="/vorath" title="Back to Vorath" className="flex items-center justify-center w-7 h-7 rounded-md text-white/40 hover:text-white/85 hover:bg-white/[0.06] transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" />
          </Link>
          <Scale className="w-4 h-4 text-violet-200/70" aria-hidden="true" />
          <div>
            <h1 className="text-[14px] font-medium text-white/90">Decision journal</h1>
            <p className="text-[10px] text-white/35">Your big calls, in your words — private to you, kept apart from Vorath&apos;s predictions.</p>
          </div>
        </header>

        <DecisionForm onSubmit={onLog} working={working === 'form'} />
        {error && <p role="alert" className="text-[11px] text-rose-200/80">{error}</p>}

        <section aria-label="Open decisions" className="flex flex-col gap-2">
          <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/40">Open · due first</h2>
          {open.length === 0 ? (
            <p className="text-[12px] text-white/45">No open decisions.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {open.map((d) => <DecisionRow key={d.id} d={d} working={working === d.id} onAction={onAction} />)}
            </ul>
          )}
        </section>

        <CalibrationPanel calibration={list.calibration} />

        {settled.length > 0 && (
          <section aria-label="Settled decisions" className="flex flex-col gap-2">
            <h2 className="text-[10px] uppercase tracking-[0.2em] text-white/40">Settled</h2>
            <ul className="flex flex-col gap-2">
              {settled.map((d) => <DecisionRow key={d.id} d={d} working={false} onAction={onAction} />)}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
