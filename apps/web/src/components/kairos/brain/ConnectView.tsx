'use client'

import { ExternalLink, Info } from 'lucide-react'
import { Step, P, Code } from '@/components/ui/kairos/KairosSetupContent'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { CopyField, Panel, tint } from './brainUi'

export function ConnectView({ status }: { status: KairosBrainStatus | null }) {
  return (
    <div className="flex flex-col gap-7">
      <P>
        Kairos thinks through your Claude account. Claude reaches Aeon through one connector called{' '}
        <Code>aeon</Code>. Add it once and you’re done.
      </P>

      <Step number={1} title="Add the connector on claude.ai">
        <P>
          Open <span className="text-white/90">Settings → Connectors</span> and choose{' '}
          <span className="text-white/90">Add custom connector</span>. Fill in:
        </P>
        <Panel className="divide-y divide-white/[0.06]">
          <CopyField label="Name" value="aeon" />
          {status ? (
            <CopyField label="URL" value={status.mcpUrl} />
          ) : (
            <div className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-24 shrink-0 text-[10.5px] uppercase tracking-[0.16em] text-white/40">URL</span>
              <span className="h-3 w-56 rounded bg-white/[0.08] animate-pulse" />
            </div>
          )}
        </Panel>
        <a
          href="https://claude.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="self-start inline-flex items-center gap-1.5 text-[11.5px] font-medium hover:brightness-125 transition"
          style={{ color: 'var(--primary)' }}
        >
          Open claude.ai <ExternalLink className="w-3 h-3" />
        </a>
      </Step>

      <Step number={2} title="Sign in to Aeon">
        <P>
          Click <span className="text-white/90">Connect</span>. Aeon opens — sign in and allow access. The connector
          should now show as connected.
        </P>
      </Step>

      <Step number={3} title="That covers your routines too">
        <div
          className="flex gap-2.5 rounded-lg border px-3.5 py-3"
          style={{ borderColor: tint('var(--primary)', 30), background: tint('var(--primary)', 6) }}
        >
          <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
          <p className="text-[12.5px] leading-relaxed text-white/75">
            Routines use the connectors on your claude.ai account. Once <Code>aeon</Code> is connected here, every
            Kairos routine can use it — nothing to install anywhere else.
          </p>
        </div>
      </Step>
    </div>
  )
}
