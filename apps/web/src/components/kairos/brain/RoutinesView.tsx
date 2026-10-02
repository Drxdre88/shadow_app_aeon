'use client'

import { useState } from 'react'
import { Check, Globe, Terminal, BrainCircuit, MessageCircle, KeyRound } from 'lucide-react'
import {
  ROUTINES, RETIRED_ROUTINE_NAMES, routinePrompt, routineScheduleRequest, type RoutineDef,
} from '@/lib/kairos/routines/catalog'
import { Code } from '@/components/ui/kairos/KairosSetupContent'
import { Chip, CopyAction, CopyField, Eyebrow, Panel, SegmentedSwitch, tint } from './brainUi'
import { cronToLocal } from './brainTime'

type Mode = 'web' | 'code'
const REPO_HINT = 'any repository you own (it is not read)'
const MODES: { id: Mode; label: string; icon: typeof Globe }[] = [
  { id: 'web', label: 'claude.ai (web form)', icon: Globe },
  { id: 'code', label: 'Claude Code (/schedule)', icon: Terminal },
]

export function RoutinesView({ nowIso }: { nowIso?: string }) {
  const [mode, setMode] = useState<Mode>('web')
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-white/60">Two routines do all of Kairos’s thinking. Set them up once.</p>
        <SegmentedSwitch options={MODES} value={mode} onChange={setMode} layoutId="kairos-routine-mode" size="sm" label="Set up with" />
      </div>
      {ROUTINES.map((def) => (
        <RoutineCard key={def.id} def={def} mode={mode} nowIso={nowIso} />
      ))}
      <RetiredList />
    </div>
  )
}

function RoutineCard({ def, mode, nowIso }: { def: RoutineDef; mode: Mode; nowIso?: string }) {
  const Icon = def.id === 'brain' ? BrainCircuit : MessageCircle
  const local = def.cronUtc && nowIso ? cronToLocal(def.cronUtc, nowIso) : null
  return (
    <Panel>
      <div className="flex items-start gap-3 px-5 pt-4 pb-3">
        <div
          className="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
          style={{ background: tint('var(--primary)', 12), color: 'var(--primary)' }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold text-white">{def.name}</span>
            <Chip>{def.trigger === 'schedule' ? 'Scheduled' : 'On demand'}</Chip>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-white/55">{def.purpose}</p>
        </div>
      </div>

      <div className="mx-5 mb-4 grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 text-[12px]">
        <span className="text-white/40">When</span>
        <span className="text-white/80 flex flex-wrap items-center gap-2">
          {def.scheduleLabel}
          {def.cronUtc && <Chip mono>{def.cronUtc}</Chip>}
          {local && <span className="text-white/45">({local})</span>}
        </span>
        <span className="text-white/40">Model</span>
        <span><Chip mono>{def.model}</Chip></span>
      </div>

      <div className="border-t border-white/[0.06] px-5 py-4 flex flex-col gap-3">
        {mode === 'web' ? <WebChecklist def={def} /> : <CodeSteps def={def} />}
        {def.trigger === 'api' && <ApiTriggerNote />}
      </div>
    </Panel>
  )
}

function WebChecklist({ def }: { def: RoutineDef }) {
  return (
    <>
      <Eyebrow>On claude.ai → Routines → New routine</Eyebrow>
      <div className="rounded-lg border border-white/[0.08] divide-y divide-white/[0.06]">
        <CopyField label="Name" value={def.name} mono={false} />
        <FieldRow label="Prompt">
          <CopyAction text={routinePrompt(def)} label="Copy prompt" primary />
        </FieldRow>
        <FieldRow label="Model"><Code>{def.model}</Code></FieldRow>
        <FieldRow label="Schedule">
          {def.cronUtc ? (
            <span>
              The form only offers presets. Pick <b className="text-white/90 font-medium">Hourly</b> — runs outside
              01–07 UTC just find nothing to do. Or, for the exact times, run <Code>/schedule update</Code> in Claude
              Code and give it <Code>{def.cronUtc}</Code>.
            </span>
          ) : (
            <span>None — leave it empty. Aeon wakes this one.</span>
          )}
        </FieldRow>
        <FieldRow label="Connectors">Only <Code>aeon</Code>. Remove the rest.</FieldRow>
        <FieldRow label="Repository">Any — it is never read.</FieldRow>
      </div>
    </>
  )
}

function CodeSteps({ def }: { def: RoutineDef }) {
  return (
    <>
      <Eyebrow>In Claude Code</Eyebrow>
      <p className="text-[12.5px] leading-relaxed text-white/65">
        Type <Code>/schedule</Code>, paste the request, and confirm. It sets the name, {def.cronUtc ? 'exact schedule, ' : ''}
        model, connector and prompt in one go.
      </p>
      <div className="flex flex-wrap gap-2">
        <CopyAction text={routineScheduleRequest(def, REPO_HINT)} label="Copy /schedule request" primary />
        <CopyAction text={routinePrompt(def)} label="Copy prompt" />
      </div>
    </>
  )
}

function ApiTriggerNote() {
  return (
    <div
      className="flex gap-2.5 rounded-lg border px-3.5 py-3"
      style={{ borderColor: tint('var(--warning)', 30), background: tint('var(--warning)', 6) }}
    >
      <KeyRound className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
      <p className="text-[12px] leading-relaxed text-white/75">
        Then, on the web: open the routine → <b className="text-white/90 font-medium">Add an API trigger</b> →{' '}
        <b className="text-white/90 font-medium">Generate token</b>. The token is shown once — copy it straight away.
      </p>
    </div>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-3.5 py-2.5">
      <span className="w-24 shrink-0 pt-0.5 text-[10.5px] uppercase tracking-[0.16em] text-white/40">{label}</span>
      <div className="flex-1 min-w-0 text-[12px] leading-relaxed text-white/70">{children}</div>
    </div>
  )
}

function RetiredList() {
  return (
    <Panel>
      <div className="px-5 pt-4 pb-1">
        <div className="text-[13px] font-semibold text-white">Delete these old routines</div>
        <p className="mt-0.5 text-[11.5px] text-white/50">
          If any of these are still on claude.ai, delete them. Kairos brain does their work now.
        </p>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 px-5 py-3.5">
        {RETIRED_ROUTINE_NAMES.map((name) => (
          <li key={name} className="flex items-center gap-2 text-[12px] text-white/55">
            <span
              className="flex items-center justify-center w-4 h-4 rounded-full shrink-0"
              style={{ background: tint('var(--success)', 14), color: 'var(--success)' }}
            >
              <Check className="w-2.5 h-2.5" />
            </span>
            <span className="font-mono line-through decoration-white/25">{name}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
