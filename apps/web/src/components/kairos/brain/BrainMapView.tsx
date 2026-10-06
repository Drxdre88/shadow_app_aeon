'use client'

import { Eye, Database, ScanFace, Scale, Lightbulb, MessageCircle, Hammer } from 'lucide-react'
import { BRAIN_JOBS, type BrainArea, type BrainJob } from '@/lib/kairos/routines/catalog'
import type { BrainKindStatus, KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { ANSWER_TONE, ANSWER_WORD, Chip, Dot, Panel, tint } from './brainUi'
import { localDateTime, relativeTo } from './brainTime'

const AREAS: { area: BrainArea; icon: typeof Eye; blurb: string }[] = [
  { area: 'Perception', icon: Eye, blurb: 'What Vorath takes in' },
  { area: 'Memory', icon: Database, blurb: 'What it keeps' },
  { area: 'Self-model', icon: ScanFace, blurb: 'How it understands you' },
  { area: 'Beliefs & conscience', icon: Scale, blurb: 'What you hold true, and staying honest' },
  { area: 'Creativity', icon: Lightbulb, blurb: 'New ideas' },
  { area: 'Voice', icon: MessageCircle, blurb: 'What it says to you' },
  { area: 'Workforce', icon: Hammer, blurb: 'How it helps your agents work' },
]

export function BrainMapView({ status }: { status: KairosBrainStatus | null }) {
  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] leading-relaxed text-white/60">
        Every job the brain routine runs, grouped by the part of Vorath it feeds. The record on the right is the last 7 days.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {AREAS.map(({ area, icon: Icon, blurb }) => {
          const jobs = BRAIN_JOBS.filter((j) => j.area === area)
          return (
            <Panel key={area}>
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-white/[0.06]">
                <div
                  className="flex items-center justify-center w-7 h-7 rounded-lg"
                  style={{ background: tint('var(--primary)', 12), color: 'var(--primary)' }}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-white">{area}</div>
                  <div className="text-[10.5px] text-white/40">{blurb}</div>
                </div>
              </div>
              <div className="divide-y divide-white/[0.05]">
                {jobs.map((job) => (
                  <JobRow
                    key={job.kind}
                    job={job}
                    record={status?.kinds.find((k) => k.kind === job.kind)}
                    nowIso={status?.generatedAt}
                  />
                ))}
              </div>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}

function JobRow({ job, record, nowIso }: { job: BrainJob; record?: BrainKindStatus; nowIso?: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12.5px] font-medium text-white/90">{job.label}</span>
          <Chip>{job.cadence}</Chip>
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-white/50">{job.what}</p>
      </div>
      <Record record={record} nowIso={nowIso} />
    </div>
  )
}

function Record({ record, nowIso }: { record?: BrainKindStatus; nowIso?: string }) {
  if (!nowIso) return <div className="w-20 h-3 mt-1 rounded bg-white/[0.06] animate-pulse shrink-0" />
  const week = record?.week ?? { routine: 0, backup: 0, missed: 0 }
  const total = week.routine + week.backup + week.missed
  if (total === 0) {
    return <div className="shrink-0 text-right text-[11px] text-white/30 pt-0.5">No runs this week</div>
  }
  const headline =
    week.routine === total
      ? { text: `${total}/${total} on Max`, tone: ANSWER_TONE.routine }
      : week.routine > 0
        ? { text: `${week.routine}/${total} on Max`, tone: 'var(--text)' }
        : null
  const extras = (['backup', 'missed'] as const).filter((k) => week[k] > 0)
  const last = record?.lastAt
  const lastTone = record?.lastAnsweredBy ? ANSWER_TONE[record.lastAnsweredBy] : 'var(--text-dim)'
  return (
    <div className="shrink-0 text-right flex flex-col items-end gap-0.5 pt-0.5">
      <div className="text-[11.5px] font-medium flex items-center gap-1.5 flex-wrap justify-end">
        {headline && <span style={{ color: headline.tone }}>{headline.text}</span>}
        {extras.map((k, i) => (
          <span key={k} style={{ color: ANSWER_TONE[k] }}>
            {(headline || i > 0) && <span className="text-white/20 mr-1.5">·</span>}
            {week[k]} {ANSWER_WORD[k]}
          </span>
        ))}
      </div>
      {last && (
        <div
          className="flex items-center gap-1.5 text-[10.5px] text-white/40"
          title={`Last run ${localDateTime(last)}${record?.lastAnsweredBy ? ` · ${ANSWER_WORD[record.lastAnsweredBy]}` : ''}`}
        >
          <Dot tone={lastTone} />
          {relativeTo(last, nowIso)}
        </div>
      )}
    </div>
  )
}
