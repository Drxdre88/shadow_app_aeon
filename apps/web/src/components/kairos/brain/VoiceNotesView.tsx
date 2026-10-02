'use client'

import { Inbox, Mic, ShieldCheck } from 'lucide-react'
import { Step, P, Code } from '@/components/ui/kairos/KairosSetupContent'
import { CopyAction, Panel, tint } from './brainUi'

export const VOICE_NOTE_PROJECT_INSTRUCTION =
  "When I say 'note for Kairos' or dictate a voice note to Kairos, call the kairos_voice_note tool with my words exactly as transcribed — no rewording or tidying beyond removing filler like 'um'. Put any summary of yours only in claudeSummary. If I name an area, find it with list_dominions and pass its id. Then tell me it is waiting for my one-tap confirmation in the Kairos inbox."

export function VoiceNotesView() {
  return (
    <div className="flex flex-col gap-7">
      <P>
        Talk to Kairos in your own words, as long as you like. Dictate in the Claude app and the{' '}
        <Code>aeon</Code> connector carries it to Kairos word for word.
      </P>

      <Step number={1} title="Teach Claude the habit (once)">
        <P>
          In claude.ai, open a Project you use for Kairos and paste this into its{' '}
          <span className="text-white/90">Project instructions</span>:
        </P>
        <Panel>
          <p className="px-3.5 py-3 text-[12.5px] leading-relaxed text-white/85 whitespace-pre-wrap">
            {VOICE_NOTE_PROJECT_INSTRUCTION}
          </p>
          <div className="flex justify-end border-t border-white/[0.06] px-3.5 py-2.5">
            <CopyAction text={VOICE_NOTE_PROJECT_INSTRUCTION} label="Copy instruction" primary />
          </div>
        </Panel>
      </Step>

      <Step number={2} title="Dictate">
        <div className="flex gap-2.5">
          <Mic className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <P>
            In that Project, tap the microphone and talk. Start with <span className="text-white/90">“note for Kairos”</span>{' '}
            so Claude knows where it goes. Name an area if it belongs to one. Long notes are fine — Kairos splits
            them into parts for you.
          </P>
        </div>
      </Step>

      <Step number={3} title="Confirm it in your inbox">
        <div className="flex gap-2.5">
          <Inbox className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <P>
            The note waits for your one-tap confirm in the Kairos inbox. Once you confirm, it counts as your own
            words. Changed your mind? Discard it and Kairos drops it.
          </P>
        </div>
        <div
          className="flex gap-2.5 rounded-lg border px-3.5 py-3"
          style={{ borderColor: tint('var(--primary)', 30), background: tint('var(--primary)', 6) }}
        >
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <p className="text-[12.5px] leading-relaxed text-white/75">
            Why the tap? Claude typed it, so until you confirm, Kairos treats it as Claude’s. Your confirm is what
            makes it yours. Any summary Claude adds is kept apart and never counts as your words.
          </p>
        </div>
      </Step>
    </div>
  )
}
