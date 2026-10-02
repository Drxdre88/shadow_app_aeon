'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { CircleCheck, ChevronDown, Eye, Mic, Terminal, MessageCircle, Send, RefreshCw, ArrowRight } from 'lucide-react'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { cn } from '@/lib/utils/cn'
import { Panel, tint } from './brainUi'
import { setupProgress } from './setupProgress'
import { SetupStep, Act, Expect, B } from './setupUi'
import { BrainStepBody, ConnectStepBody, RetiredStepBody, useRetiredCleared } from './RequiredSteps'
import { CaptureSessionsBody } from './CaptureSessionsStep'
import { VoiceNotesBody } from './VoiceNotesBody'
import { ChatOnMaxBody, TelegramBody } from './OwnerSteps'

type StepId = 'connect' | 'brain' | 'retired' | 'watched' | 'voice' | 'sessions' | 'chat' | 'telegram'

interface Props {
  status: KairosBrainStatus
  refreshing: boolean
  onRefresh: () => void
  onOpenWatched: () => void
}

export function SetupChecklist({ status, refreshing, onRefresh, onOpenWatched }: Props) {
  const p = setupProgress(status)
  const [cleared, setCleared] = useRetiredCleared()
  const [open, setOpen] = useState<StepId | null>(() => (p.connect !== 'done' ? 'connect' : p.brain !== 'done' ? 'brain' : null))
  const [moreOpen, setMoreOpen] = useState(false)
  const toggle = (id: StepId) => setOpen((cur) => (cur === id ? null : id))
  const stepProps = { status, refreshing, onRefresh }
  const brainNote = p.brain !== 'done' && p.brainRanBefore ? 'Has run before, but not in the last 26 hours' : undefined

  return (
    <div className="flex flex-col gap-5">
      <Header progress={p} refreshing={refreshing} onRefresh={onRefresh} />

      <Panel className="divide-y divide-white/[0.06]">
        <SetupStep
          marker="1" title="Connect Aeon to Claude" meta="~1 min · any Claude plan (Free allows one custom connector)"
          tick={p.connect} open={open === 'connect'} onToggle={() => toggle('connect')}
        >
          <ConnectStepBody {...stepProps} />
        </SetupStep>
        <SetupStep
          marker="2" title="Turn on Kairos’s brain" meta="~3 min · needs Claude Pro, Max, Team or Enterprise" note={brainNote}
          tick={p.brain} open={open === 'brain'} onToggle={() => toggle('brain')}
        >
          <BrainStepBody {...stepProps} ranBefore={p.brainRanBefore} />
        </SetupStep>
        {p.showRetired && (
          <SetupStep
            marker="3" title="Remove old routines" meta="~1 min · only if you set Kairos up before"
            tick={cleared ? 'done' : 'todo'} open={open === 'retired'} onToggle={() => toggle('retired')}
          >
            <RetiredStepBody cleared={cleared} onCleared={setCleared} />
          </SetupStep>
        )}
      </Panel>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className="flex items-center gap-3 px-1 text-left group outline-none"
        >
          <span className="text-[10px] uppercase tracking-[0.22em] text-white/40">Optional</span>
          <span className="text-[13px] font-semibold text-white/85 group-hover:text-white">Make Kairos see and hear more</span>
          <span className="ml-auto text-[11px] text-white/40 tabular-nums">{p.optionalDone} of {p.optionalTotal} on</span>
          <ChevronDown className={cn('w-4 h-4 text-white/35 transition-transform', moreOpen && 'rotate-180')} />
        </button>
        {moreOpen && (
          <Panel className="divide-y divide-white/[0.06]">
            <SetupStep
              marker={<Eye className="w-3.5 h-3.5" />} title="Watched boards" meta="~1 min · Kairos reads them on his own"
              tick={p.watched} open={open === 'watched'} onToggle={() => toggle('watched')}
            >
              <Act where="In the Watched tab">set a board to <B>Daily</B> (or <B>Weekly</B> for a Monday check).</Act>
              <Expect>Every card you finish there reaches Kairos the same day.</Expect>
              <button
                type="button"
                onClick={onOpenWatched}
                className="self-start inline-flex items-center gap-1 text-[11.5px] font-medium hover:brightness-125 transition"
                style={{ color: 'var(--primary)' }}
              >
                Open Watched <ArrowRight className="w-3 h-3" />
              </button>
            </SetupStep>
            <SetupStep
              marker={<Mic className="w-3.5 h-3.5" />} title="Voice notes from your phone" meta="~2 min · in the Claude app"
              tick={p.voice} open={open === 'voice'} onToggle={() => toggle('voice')}
            >
              <VoiceNotesBody />
            </SetupStep>
            <SetupStep
              marker={<Terminal className="w-3.5 h-3.5" />} title="Capture your coding sessions" meta="~5 min · Claude Code, Codex or Copilot CLI"
              tick={p.sessions} open={open === 'sessions'} onToggle={() => toggle('sessions')}
            >
              <CaptureSessionsBody {...stepProps} ticks={p.sessionTools} />
            </SetupStep>
            {status.isAdmin && (
              <>
                <SetupStep
                  marker={<MessageCircle className="w-3.5 h-3.5" />} title="Chat on Max" meta="~5 min · owner · replies on your plan, not the paid key"
                  tick={p.chat} open={open === 'chat'} onToggle={() => toggle('chat')}
                >
                  <ChatOnMaxBody {...stepProps} />
                </SetupStep>
                <SetupStep
                  marker={<Send className="w-3.5 h-3.5" />} title="Telegram bot" meta="~5 min · owner · the 06:00 message on your phone"
                  tick={p.telegram} open={open === 'telegram'} onToggle={() => toggle('telegram')}
                >
                  <TelegramBody {...stepProps} />
                </SetupStep>
              </>
            )}
          </Panel>
        )}
      </section>
    </div>
  )
}

function Header({
  progress, refreshing, onRefresh,
}: {
  progress: ReturnType<typeof setupProgress>
  refreshing: boolean
  onRefresh: () => void
}) {
  const { requiredDone, requiredTotal, allRequiredDone } = progress
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-white">
            Set up Kairos <span className="text-white/40 font-normal">· {requiredTotal} steps · ~5 minutes</span>
          </h3>
          <p className="mt-0.5 text-[12px] text-white/50">
            Ticks come from Aeon itself — they turn green when Kairos really hears from Claude.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="shrink-0 flex items-center gap-1.5 text-[10.5px] text-white/45 hover:text-white/85 transition-colors disabled:opacity-60"
        >
          <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
          Check again
        </button>
      </div>
      {allRequiredDone ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border px-4 py-3"
          style={{ borderColor: tint('var(--success)', 35), background: tint('var(--success)', 7) }}
        >
          <CircleCheck className="w-5 h-5 shrink-0" style={{ color: 'var(--success)' }} />
          <span className="text-[13px] text-white/85">Kairos is set up — he thinks every night on your Max plan.</span>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: 'var(--primary)', boxShadow: '0 0 8px var(--glow-color)' }}
              initial={false}
              animate={{ width: `${(requiredDone / requiredTotal) * 100}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 30 }}
            />
          </div>
          <span className="text-[11.5px] text-white/55 tabular-nums" role="status">
            {requiredDone} of {requiredTotal} required done
          </span>
        </div>
      )}
    </div>
  )
}
