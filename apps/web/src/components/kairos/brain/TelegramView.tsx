'use client'

import { Step, P, CodeBlock } from '@/components/ui/kairos/KairosSetupContent'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { Dot } from './brainUi'

const ENV_LINES = ['ROUTINE_CHAT_ID=trig_…', 'ROUTINE_CHAT_TOKEN=sk-ant-oat01-…', 'KAIROS_TELEGRAM_ROUTINE=1'].join('\n')

export function TelegramView({ telegram }: { telegram: KairosBrainStatus['telegram'] }) {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap gap-2">
        <Flag on={telegram.routineFlagOn} onText="Replies via routine: on" offText="Replies via routine: off" />
        <Flag on={telegram.routineConfigured} onText="Trigger ID and token: set" offText="Trigger ID and token: missing" />
      </div>
      <P>
        Telegram replies run on Max through the <span className="text-white/90">Kairos chat</span> routine. Aeon needs
        that routine’s trigger ID and token to wake it.
      </P>

      <Step number={1} title="Add these to Vercel">
        <P>
          Project → Settings → Environment Variables. Replace each <span className="font-mono">…</span> with the
          values from the Kairos chat API trigger.
        </P>
        <CodeBlock lang="env" value={ENV_LINES} />
      </Step>

      <Step number={2} title="Redeploy">
        <P>
          New variables only apply after a redeploy. Then send Kairos a message on Telegram — the chat routine should
          show as live on the Status view within a minute.
        </P>
      </Step>
    </div>
  )
}

function Flag({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  const tone = on ? 'var(--success)' : 'var(--text-dim)'
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11.5px] border border-white/[0.10] bg-white/[0.03]"
      style={{ color: on ? tone : undefined }}
    >
      <Dot tone={tone} />
      <span className={on ? undefined : 'text-white/55'}>{on ? onText : offText}</span>
    </span>
  )
}
