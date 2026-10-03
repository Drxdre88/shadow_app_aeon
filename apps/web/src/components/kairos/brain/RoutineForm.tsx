'use client'

import { useState } from 'react'
import { Globe, Terminal, CalendarClock } from 'lucide-react'
import { routinePrompt, routineScheduleRequest, type RoutineDef } from '@/lib/kairos/routines/catalog'
import { CLAUDE_ROUTINES_URL, KAIROS_CONNECTOR_NAME } from '@/lib/kairos/routines/setup'
import { Code, CopyAction, SegmentedSwitch } from './brainUi'
import { cronToLocal } from './brainTime'
import { Act, Actions, B, PrimaryLink } from './setupUi'

type Mode = 'web' | 'code'
const REPO_HINT = 'any repository you own (it is not read)'
const MODES: { id: Mode; label: string; icon: typeof Globe }[] = [
  { id: 'web', label: 'On claude.ai', icon: Globe },
  { id: 'code', label: 'In Claude Code', icon: Terminal },
]

export function RoutineForm({ def, nowIso, finish }: { def: RoutineDef; nowIso?: string; finish: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('web')
  return (
    <div className="flex flex-col gap-4">
      <SegmentedSwitch options={MODES} value={mode} onChange={setMode} layoutId={`kairos-routine-mode-${def.id}`} size="sm" label="Set up with" />
      {mode === 'web' ? (
        <Actions>
          <>
            <PrimaryLink href={CLAUDE_ROUTINES_URL} icon={<CalendarClock className="w-4 h-4" />}>Open routines</PrimaryLink>
            <Act where="In claude.ai">click <B>New routine</B>.</Act>
          </>
          <>
            <Act>Fill in the form, top to bottom:</Act>
            <FormFields def={def} nowIso={nowIso} />
          </>
          <Act>Click <B>Create</B>.</Act>
          {finish}
        </Actions>
      ) : (
        <Actions>
          <>
            <Act where="In Claude Code">type <Code>/schedule</Code> and paste this request. It sets the name,{def.cronUtc ? ' exact schedule,' : ''} model, connector and prompt in one go.</Act>
            <div className="flex flex-wrap gap-2">
              <CopyAction text={routineScheduleRequest(def, REPO_HINT)} label="Copy /schedule request" primary />
            </div>
          </>
          <Act>Confirm when Claude Code shows the routine.</Act>
          {finish}
        </Actions>
      )}
    </div>
  )
}

function FormFields({ def, nowIso }: { def: RoutineDef; nowIso?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] divide-y divide-white/[0.06]">
      <Field n={1} label="Name" copy={def.name}><span className="text-white/90">{def.name}</span></Field>
      <Field n={2} label="Prompt" copy={routinePrompt(def)} copyLabel="Copy prompt">
        Paste the whole prompt.
      </Field>
      <Field n={3} label="Model" copy={def.model}><Code>{def.model}</Code></Field>
      <Field n={4} label="Connectors">
        All connectors are included by default — <B>remove every connector except <Code>{KAIROS_CONNECTOR_NAME}</Code></B>.
      </Field>
      <Field n={5} label="Repository">Any — it is never read.</Field>
      <Field n={6} label="Schedule">
        {def.cronUtc ? (
          <span>Pick <B>Hourly</B>. {scheduleNote(def, nowIso)}</span>
        ) : (
          <span>None — leave it empty. Aeon wakes this one.</span>
        )}
      </Field>
    </div>
  )
}

// claude.ai's Hourly preset runs around the clock; the server decides when a
// run finds work, so the note says when that is for each routine.
const NIGHT_HOURS_CRON = '0 1-7 * * *'

function scheduleNote(def: RoutineDef, nowIso?: string): string {
  if (def.id === 'pulse') {
    return 'The pulse only works during the day, from about 07:00 to 22:00 London time, and only when something changed; every other run ends at once.'
  }
  const local = nowIso ? cronToLocal(NIGHT_HOURS_CRON, nowIso)?.replace(/^Hourly /, '') : null
  return `Kairos does most of his thinking at night, between 01:00 and 07:00 UTC${local ? ` (${local})` : ''}. Daytime runs only find work when daytime thinking or his self-booked check-ins are switched on; otherwise they end at once.`
}

function Field({
  n, label, copy, copyLabel = 'Copy', children,
}: {
  n: number
  label: string
  copy?: string
  copyLabel?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <span className="w-4 shrink-0 pt-0.5 text-[10.5px] tabular-nums text-white/35">{n}</span>
      <span className="w-[5.5rem] shrink-0 pt-0.5 text-[10.5px] uppercase tracking-[0.16em] text-white/45">{label}</span>
      <div className="flex-1 min-w-0 text-[12px] leading-relaxed text-white/70">{children}</div>
      {copy && <CopyAction text={copy} label={copyLabel} primary={label === 'Prompt'} />}
    </div>
  )
}
