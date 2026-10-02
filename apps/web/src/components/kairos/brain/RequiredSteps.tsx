'use client'

import { useState } from 'react'
import { Plug, Smartphone } from 'lucide-react'
import { RETIRED_ROUTINE_NAMES, getRoutine } from '@/lib/kairos/routines/catalog'
import { claudeConnectorInstallUrl, KAIROS_CONNECTOR_NAME } from '@/lib/kairos/routines/setup'
import type { KairosBrainStatus } from '@/lib/kairos/routines/status-types'
import { Code, CodeBlock, CopyField, Panel } from './brainUi'
import { Act, Actions, B, CheckAgain, Disclosure, Expect, PrimaryLink, Troubleshoot } from './setupUi'
import { RoutineForm } from './RoutineForm'

interface StepProps {
  status: KairosBrainStatus
  refreshing: boolean
  onRefresh: () => void
}

export function ConnectStepBody({ status, refreshing, onRefresh }: StepProps) {
  return (
    <>
      <Actions>
        <>
          <PrimaryLink href={claudeConnectorInstallUrl(status.mcpUrl)} icon={<Plug className="w-4 h-4" />}>
            Add to Claude
          </PrimaryLink>
          <Act where="In claude.ai">
            the connector form opens already filled in. Check it says <Code>{KAIROS_CONNECTOR_NAME}</Code>, then click <B>Add</B>.
          </Act>
          <Expect><Code>{KAIROS_CONNECTOR_NAME}</Code> appears under Connectors with a <B>Custom</B> label.</Expect>
        </>
        <>
          <Act where="Still in claude.ai">click <B>Connect</B> next to <Code>{KAIROS_CONNECTOR_NAME}</Code>, sign in to Aeon and click <B>Allow</B>.</Act>
          <Expect>Claude shows the connector as connected.</Expect>
        </>
        <>
          <Act where="In a new Claude chat">ask “list my Aeon projects”, then come back here.</Act>
          <Expect>Claude lists your boards, and this step turns green.</Expect>
          <CheckAgain onClick={onRefresh} busy={refreshing} />
        </>
      </Actions>

      <div className="flex gap-2.5 text-[12px] leading-relaxed text-white/55">
        <Smartphone className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--primary)' }} />
        <span>
          Add it on claude.ai in a computer browser. After that it works in the Claude phone app too — no extra setup.
        </span>
      </div>

      <Disclosure label="Or add it by hand">
        <p className="text-[12px] leading-relaxed text-white/60">
          In claude.ai, open <B>Settings → Connectors</B>, click <B>Add custom connector</B> and paste:
        </p>
        <Panel className="divide-y divide-white/[0.06]">
          <CopyField label="Name" value={KAIROS_CONNECTOR_NAME} />
          <CopyField label="URL" value={status.mcpUrl} />
        </Panel>
      </Disclosure>

      <Troubleshoot
        items={[
          ['The form opened empty', 'Use “Or add it by hand” above — same result.'],
          ['Claude says you’ve reached the connector limit', 'The Free plan allows one custom connector. Remove another one first, or upgrade.'],
          ['Sign-in keeps looping', 'Sign in to Aeon in the same browser first, then click Connect again.'],
          ['Connected, but this step stays grey', 'Aeon only knows once Claude actually uses it. Ask Claude something about your boards, then click Check again.'],
        ]}
      />
    </>
  )
}

export function BrainStepBody({ status, refreshing, onRefresh, ranBefore }: StepProps & { ranBefore: boolean }) {
  const brain = getRoutine('brain')
  return (
    <>
      <p className="text-[12.5px] leading-relaxed text-white/65">
        One routine on your Claude plan does all of Kairos’s thinking overnight. Claude can’t create it for you, so this
        is the one form to fill in.
      </p>
      <RoutineForm
        def={brain}
        nowIso={status.generatedAt}
        finish={
          <>
            <Act where="On the routine’s page">click <B>Run now</B>.</Act>
            <Expect>
              If a job is waiting, this step turns green within a minute. During the day there is often nothing due — then
              it turns green after tonight’s first run.
            </Expect>
            <CheckAgain onClick={onRefresh} busy={refreshing} />
          </>
        }
      />
      <Disclosure label="Want the exact hours instead of Hourly?">
        <p className="text-[12px] leading-relaxed text-white/60">
          In Claude Code, run <Code>/schedule update</Code>, pick <B>{brain.name}</B> and give it this schedule (UTC):
        </p>
        <CodeBlock lang="cron" value={brain.cronUtc ?? ''} />
      </Disclosure>
      <Troubleshoot
        items={[
          ['Claude shows a green run, but this step stays grey', 'A green run in Claude only means it started. Open the routine and check aeon is the only connector, and that it’s connected.'],
          ['“Routines” isn’t in your Claude menu', 'Routines need a Pro, Max, Team or Enterprise plan.'],
          [ranBefore ? 'It used to run, now it’s quiet' : 'Still grey the next morning', 'Open the routine on claude.ai and check it’s switched on and set to Hourly, then click Run now.'],
        ]}
      />
    </>
  )
}

const RETIRED_KEY = 'kairos-setup-retired-cleared'

function readCleared(): boolean {
  try { return window.localStorage.getItem(RETIRED_KEY) === '1' } catch { return false }
}

export function useRetiredCleared(): [boolean, (v: boolean) => void] {
  const [cleared, setCleared] = useState(readCleared)
  const set = (v: boolean) => {
    setCleared(v)
    try { window.localStorage.setItem(RETIRED_KEY, v ? '1' : '0') } catch { /* storage blocked */ }
  }
  return [cleared, set]
}

export function RetiredStepBody({ cleared, onCleared }: { cleared: boolean; onCleared: (v: boolean) => void }) {
  return (
    <>
      <Act where="In claude.ai → Routines">delete any of these that are still there. Kairos brain does their work now.</Act>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {RETIRED_ROUTINE_NAMES.map((name) => (
          <li key={name} className="flex items-center gap-2 text-[12px] font-mono text-white/60">
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--text-dim)' }} />
            {name}
          </li>
        ))}
      </ul>
      <label className="self-start inline-flex items-center gap-2 text-[12px] text-white/70 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={cleared}
          onChange={(e) => onCleared(e.target.checked)}
          className="w-3.5 h-3.5 rounded"
          style={{ accentColor: 'var(--success)' }}
        />
        I’ve deleted them
      </label>
      <p className="text-[11px] text-white/40">
        Aeon can’t see your claude.ai routines, so this tick is yours to set.
      </p>
    </>
  )
}
