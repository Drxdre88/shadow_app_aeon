'use client'

import { useState } from 'react'
import { RefreshCw, TriangleAlert, CircleCheck, BrainCircuit, MessageCircle, ArrowRight, KeyRound, Activity } from 'lucide-react'
import { BRAIN_JOBS, ROUTINES } from '@/lib/kairos/routines/catalog'
import type { AnsweredBy, KairosBrainStatus, KairosChatLatency, KairosPaidBackupStatus } from '@/lib/kairos/routines/status-types'
import { setPaidBackup } from '@/lib/actions/kairos-brain'
import { cn } from '@/lib/utils/cn'
import { ANSWER_TONE, ANSWER_WORD, ROUTINE_STATE, Dot, Panel, Eyebrow, tint } from './brainUi'
import { localDateTime, relativeTo, localClock } from './brainTime'
import type { BrainView } from './ConnectKairosModal'

const ORDER: AnsweredBy[] = ['routine', 'backup', 'missed']
const ROUTINE_ICON = { brain: BrainCircuit, chat: MessageCircle, pulse: Activity }

function seconds(ms: number): string {
  return ms < 100_000 ? `${Math.round(ms / 1000)} s` : `${(ms / 60_000).toFixed(1)} min`
}

// One plain line for the chat row, e.g. "Replies in ~38 s (p95 71 s) · 2 fire failures".
function chatLatencyLine(l: KairosChatLatency): string {
  const parts: string[] = []
  if (l.p50Ms !== null) parts.push(`Replies in ~${seconds(l.p50Ms)}${l.p95Ms !== null ? ` (p95 ${seconds(l.p95Ms)})` : ''}`)
  else if (l.backupP50Ms !== null) parts.push(`Backup replies in ~${seconds(l.backupP50Ms)}`)
  else parts.push(`${l.turns} ${l.turns === 1 ? 'reply' : 'replies'} this week`)
  if (l.fireFailures > 0) parts.push(`${l.fireFailures} fire ${l.fireFailures === 1 ? 'failure' : 'failures'}`)
  return parts.join(' · ')
}

interface Props {
  status: KairosBrainStatus
  refreshing: boolean
  onRefresh: () => void
  onNavigate: (view: BrainView) => void
}

export function StatusView({ status, refreshing, onRefresh, onNavigate }: Props) {
  const { lastNight, backupKinds } = status
  const total = lastNight.routine + lastNight.backup + lastNight.missed
  const allOnMax = total > 0 && lastNight.backup === 0 && lastNight.missed === 0
  const brainOff = status.routines.find((r) => r.id === 'brain')?.state === 'off'
  // The pulse is optional (daytime thinking): shown only once it is switched on.
  const shown = ROUTINES.filter((def) => def.id !== 'pulse' || (status.routines.find((r) => r.id === 'pulse')?.state ?? 'off') !== 'off')

  return (
    <div className="flex flex-col gap-5">
      <Panel>
        <div className="flex items-center justify-between px-5 pt-4">
          <Eyebrow>Last night</Eyebrow>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[10.5px] text-white/45 hover:text-white/85 transition-colors disabled:opacity-60"
            title="Check again"
          >
            <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
            Checked {localClock(status.generatedAt)}
          </button>
        </div>
        {total === 0 ? (
          <div className="px-5 pt-2 pb-5">
            <div className="text-[22px] font-semibold text-white/80">Nothing ran last night</div>
            <p className="mt-1 text-[12.5px] text-white/55">
              No thinking was recorded since midnight UTC yesterday.{' '}
              {brainOff ? 'The brain routine isn’t set up yet.' : 'Check the brain routine is switched on.'}
            </p>
            <NavLink onClick={() => onNavigate('setup')}>Open setup</NavLink>
          </div>
        ) : (
          <div className="px-5 pt-2 pb-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[24px] font-semibold tracking-tight">
              {ORDER.map((key, i) => (
                <span key={key} className="flex items-baseline gap-3">
                  {i > 0 && <span className="text-white/20">·</span>}
                  <span
                    style={{ color: lastNight[key] > 0 ? ANSWER_TONE[key] : undefined }}
                    className={cn(lastNight[key] === 0 && 'text-white/30')}
                  >
                    {lastNight[key]} {ANSWER_WORD[key]}
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[12.5px] text-white/55">
              {allOnMax
                ? 'Every job ran on your Claude Max plan. Nothing cost extra.'
                : `${lastNight.routine} of ${total} jobs ran on your Claude Max plan.`}
            </p>
          </div>
        )}
        <div className={cn('grid grid-cols-1 border-t border-white/[0.06] divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06]', shown.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          {shown.map((def) => {
            const live = status.routines.find((r) => r.id === def.id)
            const state = ROUTINE_STATE[live?.state ?? 'off']
            const Icon = ROUTINE_ICON[def.id]
            return (
              <div key={def.id} className="flex items-start gap-3 px-5 py-4">
                <div
                  className="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
                  style={{ background: tint('var(--primary)', 12), color: 'var(--primary)' }}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1" title={state.hint}>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-white">{def.name}</span>
                    <span className="flex items-center gap-1.5 text-[10.5px] font-medium" style={{ color: state.tone }}>
                      <Dot tone={state.tone} pulse={live?.state === 'live'} />
                      {state.label}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-white/50">
                    {live?.lastClaimAt
                      ? `Last claimed ${localDateTime(live.lastClaimAt)} · ${relativeTo(live.lastClaimAt, status.generatedAt)}`
                      : def.trigger === 'api' ? 'No Telegram message answered yet' : 'Has never claimed a job'}
                  </div>
                  {def.id === 'chat' && status.chatLatency && (
                    <div className="mt-0.5 text-[11.5px] text-white/50">{chatLatencyLine(status.chatLatency)}</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      {backupKinds.length > 0 ? (
        <div
          className="rounded-xl border px-4 py-3.5 flex gap-3"
          style={{ borderColor: tint('var(--warning)', 35), background: tint('var(--warning)', 7) }}
        >
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-white/90">
              These ran on the paid backup in the last 24 h — your routine isn’t claiming them
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {backupKinds.map((kind) => (
                <span
                  key={kind}
                  className="px-2 py-0.5 rounded-md text-[11px] border"
                  style={{ color: 'var(--warning)', borderColor: tint('var(--warning)', 30) }}
                >
                  {BRAIN_JOBS.find((j) => j.kind === kind)?.label ?? kind}
                </span>
              ))}
            </div>
            <NavLink onClick={() => onNavigate('map')}>See the brain map</NavLink>
          </div>
        </div>
      ) : (
        total > 0 && (
          <div className="flex items-center gap-2 px-1 text-[12px] text-white/50">
            <CircleCheck className="w-3.5 h-3.5" style={{ color: 'var(--success)' }} />
            Nothing fell back to the paid backup in the last 24 h.
          </div>
        )
      )}

      {status.paidBackup && <PaidBackupRow paidBackup={status.paidBackup} />}
    </div>
  )
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// The "Paid backup" switch: optimistic, reverted (with a note) if the save fails.
function PaidBackupRow({ paidBackup }: { paidBackup: KairosPaidBackupStatus }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const enabled = override ?? paidBackup.enabled

  const toggle = async () => {
    const previous = enabled
    const next = !previous
    setOverride(next)
    setError(null)
    setSaving(true)
    try {
      const res = await setPaidBackup(next)
      setOverride(res.enabled)
    } catch {
      setOverride(previous)
      setError('Couldn’t save — the switch is back where it was. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const tone = enabled ? 'var(--warning)' : 'var(--success)'
  return (
    <Panel>
      <div className="flex items-start gap-3 px-5 py-4">
        <div
          className="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
          style={{ background: tint(tone, 12), color: tone }}
        >
          <KeyRound className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span id="kairos-paid-backup-label" className="text-[13px] font-semibold text-white">Paid backup</span>
            <span className="text-[10.5px] font-medium" style={{ color: tone }}>{enabled ? 'On' : 'Off'}</span>
          </div>
          <p className="mt-0.5 text-[11.5px] text-white/55">
            {enabled
              ? `If your Max routine misses a job, Kairos pays your API key to cover it (${plural(paidBackup.paidCallsLast7d, 'time')} in the last 7 days).`
              : 'Never uses your API key. A missed job waits for the next run; the 06:00 message falls back to plain text.'}
          </p>
          {error && (
            <p role="alert" className="mt-1.5 text-[11.5px]" style={{ color: 'var(--error)' }}>{error}</p>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="kairos-paid-backup-label"
          onClick={toggle}
          disabled={saving}
          className={cn(
            'relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors outline-none',
            'focus-visible:ring-1 focus-visible:ring-[color:var(--primary)] disabled:opacity-60',
            !enabled && 'bg-white/[0.06] border-white/[0.12]',
          )}
          style={enabled ? { background: tint('var(--primary)', 35), borderColor: tint('var(--primary)', 60) } : undefined}
        >
          <span
            className={cn(
              'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-[18px]' : 'translate-x-[2px]',
            )}
          />
        </button>
      </div>
    </Panel>
  )
}

function NavLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium hover:brightness-125 transition"
      style={{ color: 'var(--primary)' }}
    >
      {children}
      <ArrowRight className="w-3 h-3" />
    </button>
  )
}

export function StatusSkeleton() {
  return (
    <div className="flex flex-col gap-5 animate-pulse" aria-busy="true" aria-label="Checking Kairos">
      <Panel>
        <div className="px-5 py-5 flex flex-col gap-3">
          <div className="h-2.5 w-20 rounded bg-white/[0.08]" />
          <div className="h-7 w-3/4 rounded bg-white/[0.08]" />
          <div className="h-3 w-1/2 rounded bg-white/[0.06]" />
        </div>
        <div className="grid grid-cols-2 border-t border-white/[0.06] divide-x divide-white/[0.06]">
          {[0, 1].map((i) => (
            <div key={i} className="px-5 py-4 flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/[0.06]" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="h-3 w-24 rounded bg-white/[0.08]" />
                <div className="h-2.5 w-36 rounded bg-white/[0.05]" />
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
