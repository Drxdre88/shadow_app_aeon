'use client'

import { ShieldCheck } from 'lucide-react'
import { KAIROS_CONNECTOR_NAME } from '@/lib/kairos/routines/setup'
import { Code, CopyAction, Panel, tint } from './brainUi'
import { Act, Actions, B, Expect } from './setupUi'

export const VOICE_NOTE_PROJECT_INSTRUCTION =
  "When I say 'note for Kairos' or dictate a voice note to Kairos, call the kairos_voice_note tool with my words exactly as transcribed — no rewording or tidying beyond removing filler like 'um'. Put any summary of yours only in claudeSummary. If I name an area, find it with list_dominions and pass its id. Then tell me it is waiting for my one-tap confirmation in the Kairos inbox."

export function VoiceNotesBody() {
  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-white/65">
        Talk to Kairos from your phone, as long as you like. Needs step 1 done — the <Code>{KAIROS_CONNECTOR_NAME}</Code>{' '}
        connector carries your words to Kairos word for word.
      </p>
      <Actions>
        <>
          <Act where="In claude.ai on a computer">open a Project for Kairos (or click <B>New project</B>) and paste this into its <B>Project instructions</B>:</Act>
          <Panel>
            <p className="px-3.5 py-3 text-[12px] leading-relaxed text-white/80 whitespace-pre-wrap">
              {VOICE_NOTE_PROJECT_INSTRUCTION}
            </p>
            <div className="flex justify-end border-t border-white/[0.06] px-3.5 py-2.5">
              <CopyAction text={VOICE_NOTE_PROJECT_INSTRUCTION} label="Copy instruction" primary />
            </div>
          </Panel>
        </>
        <>
          <Act where="In the Claude phone app">open that Project, tap the microphone and start with “note for Kairos”. Name an area if it belongs to one.</Act>
          <Expect>Claude says the note is waiting in your Kairos inbox, and this step turns green.</Expect>
        </>
        <>
          <Act where="In Aeon">open the Kairos inbox and tap <B>Confirm</B> on the note.</Act>
          <Expect>It now counts as your own words. Changed your mind? Discard it and Kairos drops it.</Expect>
        </>
      </Actions>
      <div
        className="flex gap-2.5 rounded-lg border px-3.5 py-3"
        style={{ borderColor: tint('var(--primary)', 30), background: tint('var(--primary)', 6) }}
      >
        <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
        <p className="text-[12px] leading-relaxed text-white/70">
          Why the tap? Claude typed it, so until you confirm, Kairos treats it as Claude’s. Any summary Claude adds is
          kept apart and never counts as your words.
        </p>
      </div>
    </>
  )
}
